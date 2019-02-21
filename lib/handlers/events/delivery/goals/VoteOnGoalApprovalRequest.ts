/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    Configuration,
    EventFired,
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
    Value,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    addressChannelsFor,
    CredentialsResolver,
    GoalApprovalRequestVote,
    GoalApprovalRequestVoteDecisionManager,
    GoalApprovalRequestVoter,
    GoalApprovalRequestVoterInvocation,
    GoalImplementationMapper,
    PreferenceStoreFactory,
    RepoRefResolver,
    SdmGoalEvent,
    SdmGoalState,
    SoftwareDeliveryMachineConfiguration,
    UnanimousGoalApprovalRequestVoteDecisionManager,
    updateGoal,
} from "@atomist/sdm";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { verifyGoal } from "../../../../internal/signing/goalSigning";
import { OnAnyApprovedSdmGoal } from "../../../../typings/types";

/**
 * Vote on approved goals.
 *
 * This allows GoalApprovalVoter instances to vote on the approved goal to decide
 * if this approval request can be granted or not.
 *
 * The final decision if the request should be granted based on all votes is delegated to the
 * configured instance of GoalApprovalRequestVoteDecisionManager.
 */
@EventHandler("Vote on started or approved goals",
    GraphQL.subscription("OnAnyApprovedSdmGoal"))
export class VoteOnGoalApprovalRequest implements HandleEvent<OnAnyApprovedSdmGoal.Subscription> {

    @Value("")
    public configuration: SoftwareDeliveryMachineConfiguration;

    constructor(private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly voters: GoalApprovalRequestVoter[],
                private readonly decisionManager: GoalApprovalRequestVoteDecisionManager,
                private readonly implementationMapper: GoalImplementationMapper,
                private readonly preferenceStoreFactory: PreferenceStoreFactory) {
        if (this.voters.length === 0) {
            this.voters.push(async () => ({ vote: GoalApprovalRequestVote.Granted }));
        }
        if (!this.decisionManager) {
            this.decisionManager = UnanimousGoalApprovalRequestVoteDecisionManager;
        }
    }

    public async handle(event: EventFired<OnAnyApprovedSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const sdmGoal: SdmGoalEvent = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        await verifyGoal(sdmGoal, this.configuration.sdm.goalSigning, context);

        const id = this.repoRefResolver.repoRefFromPush(sdmGoal.push);
        const credentials = this.credentialsFactory.eventHandlerCredentials(context, id);
        const preferences = this.preferenceStoreFactory(context);

        const garvi: GoalApprovalRequestVoterInvocation = {
            id,
            context,
            credentials,
            addressChannels: addressChannelsFor(sdmGoal.push.repo, context),
            configuration: this.configuration,
            preferences,
            goal: sdmGoal,
        };

        const votes = await Promise.all(this.voters.map(v => v(garvi)));
        const decision = this.decisionManager(...votes);
        const goal = this.implementationMapper.findGoalBySdmGoal(sdmGoal);

        switch (decision) {
            case GoalApprovalRequestVote.Granted:
                if (sdmGoal.state === SdmGoalState.pre_approved) {
                    let g = sdmGoal;
                    const cbs = this.implementationMapper.findFulfillmentCallbackForGoal(sdmGoal);
                    for (const cb of cbs) {
                        g = await cb.callback(g, {
                            id,
                            addressChannels: undefined,
                            preferences,
                            credentials,
                            configuration: this.configuration,
                            context,
                        });
                    }
                    await updateGoal(context, sdmGoal, {
                        state: SdmGoalState.requested,
                        description: goal.requestedDescription,
                        data: g.data,
                    });
                } else if (sdmGoal.state === SdmGoalState.approved) {
                    await updateGoal(context, sdmGoal, {
                        state: SdmGoalState.success,
                        description: goal.successDescription,
                    });
                }
                break;
            case GoalApprovalRequestVote.Denied:
                if (sdmGoal.state === SdmGoalState.pre_approved) {
                    const g: SdmGoalEvent = {
                        ...sdmGoal,
                        preApproval: undefined,
                    };
                    await updateGoal(context, g, {
                        state: SdmGoalState.waiting_for_pre_approval,
                        description: `${goal.waitingForPreApprovalDescription} | start by @${sdmGoal.preApproval.userId} denied`,
                    });
                } else if (sdmGoal.state === SdmGoalState.approved) {
                    const g: SdmGoalEvent = {
                        ...sdmGoal,
                        approval: undefined,
                    };
                    await updateGoal(context, g, {
                        state: SdmGoalState.waiting_for_approval,
                        description: `${goal.waitingForApprovalDescription} | approval by @${sdmGoal.approval.userId} denied`,
                    });
                }
                break;
            case GoalApprovalRequestVote.Abstain:
                // We don't do anything if vote isn't either granted or denied
                break;
        }

        return Success;
    }
}
