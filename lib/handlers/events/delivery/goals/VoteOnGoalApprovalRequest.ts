/*
 * Copyright © 2018 Atomist, Inc.
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
    EventFired,
    EventHandler,
    GraphQL,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import {
    addressChannelsFor,
    CredentialsResolver,
    GoalApprovalRequestVote,
    GoalApprovalRequestVoter,
    GoalApprovalRequestVoterInvocation,
    RepoRefResolver,
    SdmGoalEvent,
    SdmGoalState,
    updateGoal,
} from "@atomist/sdm";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { OnAnyApprovedSdmGoal } from "../../../../typings/types";

/**
 * Vote on approved goals.
 *
 * This allows GoalApprovalVoter instances to vote on the approved goal to decide
 * if this approval request can be granted or not.
 *
 * If one voter denies the request, it will we discarded.
 */
@EventHandler("Vote on approved goals",
    GraphQL.subscription("OnAnyApprovedSdmGoal"))
export class VoteOnGoalApprovalRequest implements HandleEvent<OnAnyApprovedSdmGoal.Subscription> {

    constructor(private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly voters: GoalApprovalRequestVoter[]) {
    }

    public async handle(event: EventFired<OnAnyApprovedSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const sdmGoal: SdmGoalEvent = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        const id = this.repoRefResolver.repoRefFromPush(sdmGoal.push);

        const garvi: GoalApprovalRequestVoterInvocation = {
            id,
            context,
            credentials: this.credentialsFactory.eventHandlerCredentials(context, id),
            addressChannels: addressChannelsFor(sdmGoal.push.repo, context),
            goal: sdmGoal,
        };

        const votes = await Promise.all(this.voters.map(v => v(garvi)));

        // Policy for now is if one vote denies, we deny the request.
        if (!votes.some(v => v.vote === GoalApprovalRequestVote.Denied)) {
             if (sdmGoal.state === SdmGoalState.pre_approved) {
                 await updateGoal(context, sdmGoal, {
                     state: SdmGoalState.requested,
                     description: cleanDescription(sdmGoal.description),
                 });
             } else if (sdmGoal.state === SdmGoalState.approved) {
                 await updateGoal(context, sdmGoal, {
                     state: SdmGoalState.success,
                     description: cleanDescription(sdmGoal.description),
                 });
             }
        } else {
            if (sdmGoal.state === SdmGoalState.pre_approved) {
                const goal: SdmGoalEvent = {
                    ...sdmGoal,
                    preApproval: undefined,
                };
                await updateGoal(context, goal, {
                    state: SdmGoalState.waiting_for_pre_approval,
                    description: `${sdmGoal.description} | start by @${sdmGoal.preApproval.userId} denied`,
                });
            } else if (sdmGoal.state === SdmGoalState.approved) {
                const goal: SdmGoalEvent = {
                    ...sdmGoal,
                    approval: undefined,
                };
                await updateGoal(context, goal, {
                    state: SdmGoalState.waiting_for_approval,
                    description: `${sdmGoal.description} | approval by @${sdmGoal.approval.userId} denied`,
                });
            }
        }

        return Success;
    }
}

function cleanDescription(description: string): string {
    if (description.startsWith("Start required: ")) {
        return description.slice("Start required:".length).trim();
    } else if (description.startsWith("Approval required:")) {
        return description.slice("Approval required:".length).trim();
    } else {
        return description;
    }
}