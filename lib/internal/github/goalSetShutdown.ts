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

import { logger } from "@atomist/automation-client";
import {
    GoalCompletionListener,
    GoalCompletionListenerInvocation,
    goalKeyString,
    SdmGoalEvent,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import { SdmGoalState } from "../../typings/types";

export function registerExitOnGoalSetCompletionListener(sdm: SoftwareDeliveryMachine) {
    sdm.addGoalCompletionListener(exitOnGoalCompletion());
}

function exitOnGoalCompletion(): GoalCompletionListener {
    return async (inv: GoalCompletionListenerInvocation) => {
        const { completedGoal, allGoals } = inv;
        if (process.argv.length >= 3) {
            if (completedGoal.name === process.argv.slice(2).join(" ")) {
                if (completedGoal.state === SdmGoalState.failure) {
                    logger.info("Exciting because %s failed", completedGoal.uniqueName);
                    setTimeout(() => process.exit(1), 5000);
                } else {
                    logger.info("Exciting because goal was success or waiting");
                    setTimeout(() => process.exit(0), 5000);
                }
            }
        } else {
            logger.info("Completed goal: '%s' with '%s' in set '%s'",
                goalKeyString(completedGoal), completedGoal.state, completedGoal.goalSetId);

            if (completedGoal.state === SdmGoalState.failure) {
                logger.info("Exciting because %s failed", completedGoal.uniqueName);
                setTimeout(() => process.exit(1), 5000);
            }
            if (allSuccessful(allGoals)) {
                logger.info("Exciting because all goals success or waiting");
                setTimeout(() => process.exit(0), 5000);
            }
        }
    };
}

function allSuccessful(goals: SdmGoalEvent[]): boolean {
    goals.forEach(g => logger.debug("goal %s is %s", g.name, g.state));
    return !goals.some(g =>
        g.state !== SdmGoalState.success &&
        g.state !== SdmGoalState.stopped &&
        g.state !== SdmGoalState.canceled &&
        g.state !== SdmGoalState.waiting_for_approval &&
        g.state !== SdmGoalState.waiting_for_pre_approval);
}
