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
    SdmGoalEvent,
    SdmGoalKey,
    SdmGoalState,
} from "@atomist/sdm";
import { fetchGoalsForCommit } from "@atomist/sdm/lib/api-helper/goal/fetchGoalsOnCommit";
import { goalKeyEquals } from "@atomist/sdm/lib/api-helper/goal/sdmGoal";
import { updateGoal } from "@atomist/sdm/lib/api-helper/goal/storeGoals";
import { RepoRefResolver } from "@atomist/sdm/lib/spi/repo-ref/RepoRefResolver";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { OnAnyFailedSdmGoal } from "../../../../typings/types";

/**
 * Respond to a failure status by failing downstream goals
 */
@EventHandler("Fail downstream goals on a goal failure", GraphQL.subscription("OnAnyFailedSdmGoal"))
export class SkipDownstreamGoalsOnGoalFailure implements HandleEvent<OnAnyFailedSdmGoal.Subscription> {

    constructor(private readonly repoRefResolver: RepoRefResolver) {}

    public async handle(event: EventFired<OnAnyFailedSdmGoal.Subscription>,
                        context: HandlerContext,
                        params: this): Promise<HandlerResult> {

        const failedGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(failedGoal)) {
            logger.debug(`Goal ${failedGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        const id = params.repoRefResolver.repoRefFromPush(failedGoal.push);
        const goals = await fetchGoalsForCommit(context, id, failedGoal.repo.providerId, failedGoal.goalSetId);

        const goalsToSkip = goals.filter(g => isDependentOn(failedGoal, g, mapKeyToGoal(goals)))
            .filter(g => g.state === "planned");

        await Promise.all(goalsToSkip.map(g => updateGoal(context, g, {
            state: SdmGoalState.skipped,
            description: `Skipped ${g.name} because ${failedGoal.name} failed`,
        })));

        return Success;
    }
}

function mapKeyToGoal<T extends SdmGoalKey>(goals: T[]): (SdmGoalKey) => T {
    return (keyToFind: SdmGoalKey) => {
        const found = goals.find(g => goalKeyEquals(keyToFind, g));
        return found;
    };
}

function isDependentOn(failedGoal: SdmGoalKey, goal: SdmGoalEvent, preconditionToGoal: (g: SdmGoalKey) => SdmGoalEvent): boolean {
    if (!goal) {
        // TODO we think this is caused by automation-api#396
        logger.warn("Internal error: Trying to work out if %j is dependent on null or undefined goal", failedGoal);
        return false;
    }
    if (!goal.preConditions || goal.preConditions.length === 0) {
        return false; // no preconditions? not dependent
    }
    if (mapKeyToGoal(goal.preConditions)(failedGoal)) {
        return true; // the failed goal is one of my preconditions? dependent
    }
    // otherwise, recurse on my preconditions
    return !!goal.preConditions
        .map(precondition => isDependentOn(failedGoal, preconditionToGoal(precondition), preconditionToGoal))
        .find(a => a); // if one is true, return true
}
