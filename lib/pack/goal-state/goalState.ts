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
    ExtensionPack,
    logger,
    metadata,
} from "@atomist/sdm";
import { isInLocalMode } from "../../internal/machine/LocalSoftwareDeliveryMachineOptions";
import { resetGoalsCommand } from "./resetGoals";
import { setGoalStateCommand } from "./setGoalState";

/**
 * Allow goal setting
 */
export const GoalState: ExtensionPack = {
    ...metadata("goal-state"),
    configure: sdm => {
        if (isInLocalMode()) {
            logger.warn("Setting goal state is not available in local mode.");
            logger.warn("Resetting goals does not work in local mode. Use `atomist trigger post-commit` instead.");
        } else {
            sdm.addCommand(setGoalStateCommand(sdm));
            sdm.addCommand(resetGoalsCommand(sdm));
        }
    },
};
