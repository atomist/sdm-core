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
    mapKeyToGoal,
    SdmGoalEvent,
    SdmGoalKey,
    SdmGoalState,
    updateGoal,
} from "@atomist/sdm";
import * as _ from "lodash";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { OnAnyFailedSdmGoal } from "../../../../typings/types";

/**
 * Skip downstream goals on failed, stopped or canceled goal
 */
@EventHandler("Skip downstream goals on failed, stopped or canceled goal",
    GraphQL.subscription("OnAnyFailedSdmGoal"))
export class SkipDownstreamGoalsOnGoalFailure implements HandleEvent<OnAnyFailedSdmGoal.Subscription> {

    public async handle(event: EventFired<OnAnyFailedSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const failedGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(failedGoal)) {
            logger.debug(`Goal ${failedGoal.uniqueName} skipped because not relevant for this SDM`);
            return Success;
        }

        const goals = event.data.SdmGoal[0].push.goals.filter(g => g.goalSet === failedGoal.goalSetId) as SdmGoalEvent[];
        const push = _.cloneDeep(event.data.SdmGoal[0].push);
        delete push.goals;
        goals.forEach(g => g.push = push);

        const goalsToSkip = goals.filter(g => isDependentOn(failedGoal, g, mapKeyToGoal(goals)))
            .filter(g => g.state === "planned");

        let failedGoalState;
        switch (failedGoal.state) {
            case SdmGoalState.failure:
                failedGoalState = "failed";
                break;
            case SdmGoalState.stopped:
                failedGoalState = "stopped goals";
                break;
            case SdmGoalState.canceled:
                failedGoalState = "was canceled";
                break;
        }
        await Promise.all(goalsToSkip.map(g => updateGoal(context, g, {
            state: SdmGoalState.skipped,
            description: `Skipped ${g.name} because ${failedGoal.name} ${failedGoalState}`,
        })));

        return Success;
    }
}

function isDependentOn(failedGoal: SdmGoalKey, goal: SdmGoalEvent, preconditionToGoal: (g: SdmGoalKey) => SdmGoalEvent): boolean {
    if (!goal) {
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
