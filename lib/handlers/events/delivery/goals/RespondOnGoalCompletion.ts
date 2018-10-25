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
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    addressChannelsFor,
    CredentialsResolver,
    GoalCompletionListener,
    GoalCompletionListenerInvocation,
    RepoRefResolver,
    SdmGoalEvent,
} from "@atomist/sdm";
import * as _ from "lodash";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { OnAnyCompletedSdmGoal } from "../../../../typings/types";

/**
 * Respond to a failure or success status by running listeners
 */
@EventHandler("Run a listener on goal failure or success",
    GraphQL.subscription("OnAnyCompletedSdmGoal"))
export class RespondOnGoalCompletion implements HandleEvent<OnAnyCompletedSdmGoal.Subscription> {

    constructor(private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly goalCompletionListeners: GoalCompletionListener[]) {
    }

    public async handle(event: EventFired<OnAnyCompletedSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const sdmGoal: SdmGoalEvent = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.uniqueName} skipped because not relevant for this SDM`);
            return Success;
        }

        const id = this.repoRefResolver.repoRefFromPush(sdmGoal.push);

        const allGoals = event.data.SdmGoal[0].push.goals.filter(g => g.goalSet === sdmGoal.goalSetId) as SdmGoalEvent[];
        const push = _.cloneDeep(event.data.SdmGoal[0].push);
        delete push.goals;
        allGoals.forEach(g => g.push = push);

        const gsi: GoalCompletionListenerInvocation = {
            id,
            context,
            credentials: this.credentialsFactory.eventHandlerCredentials(context, id),
            addressChannels: addressChannelsFor(sdmGoal.push.repo, context),
            allGoals,
            completedGoal: sdmGoal,
        };

        await Promise.all(this.goalCompletionListeners.map(l => l(gsi)));
        return Success;
    }
}
