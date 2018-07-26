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
    HandleEvent,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
    Value,
} from "@atomist/automation-client";
import { subscription } from "@atomist/automation-client/graph/graphQL";
import {
    GoalApprovalRequestVoteInvocation,
    GoalApprovalRequestVoteResult,
    GoalApprovalRequestVoterRegistration,
    SdmGoalEvent,
    SdmGoalState,
} from "@atomist/sdm";
import { updateGoal } from "@atomist/sdm/api-helper/goal/storeGoals";
import { addressChannelsFor } from "@atomist/sdm/api/context/addressChannels";
import { CredentialsResolver } from "@atomist/sdm/spi/credentials/CredentialsResolver";
import { RepoRefResolver } from "@atomist/sdm/spi/repo-ref/RepoRefResolver";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { OnAnyApprovedSdmGoal } from "../../../../typings/types";

/**
 * Vote on approved goals.
 *
 * This allows GoalApprovalVoter instances to vote on the approval goal to decide
 * if this approval request can be granted or not.
 *
 * If one voter denies the request, it will we discarded.
 */
@EventHandler("Vote on approved goals",
    subscription("OnAnyApprovedSdmGoal"))
export class VoteOnGoalApprovalRequest implements HandleEvent<OnAnyApprovedSdmGoal.Subscription> {

    @Value("token")
    public token: string;

    constructor(private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly voters: GoalApprovalRequestVoterRegistration[]) {
    }

    public async handle(event: EventFired<OnAnyApprovedSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const sdmGoal: SdmGoalEvent = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        const id = this.repoRefResolver.repoRefFromPush(sdmGoal.push);
        (this.credentialsFactory as any).githubToken = this.token;

        const garvi: GoalApprovalRequestVoteInvocation = {
            id,
            context,
            credentials: this.credentialsFactory.eventHandlerCredentials(context, id),
            addressChannels: addressChannelsFor(sdmGoal.push.repo, context),
            goal: sdmGoal,
        };

        const votes = await Promise.all(this.voters.map(v => v.vote(garvi)));

        // Policy for now is if one vote denies, we deny the request.
        if (!votes.some(v => v === GoalApprovalRequestVoteResult.Denied)) {
            await updateGoal(context, sdmGoal, {
                state: SdmGoalState.success,
                description: sdmGoal.description,
            });
        }

        return Success;
    }
}
