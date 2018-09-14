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
    DefaultGoalNameGenerator,
    FulfillableGoal,
    FulfillableGoalDetails,
    getGoalDefintionFrom,
    Goal,
} from "@atomist/sdm";
import { TagGoal } from "@atomist/sdm/lib/pack/well-known-goals/commonGoals";
import { executeTag } from "../../internal/delivery/build/executeTag";

/**
 * Goal that performs project tagging
 */
export class Tag extends FulfillableGoal {

    constructor(private readonly goalDetailsOrUniqueName: FulfillableGoalDetails | string = DefaultGoalNameGenerator.generateName("tag"),
                ...dependsOn: Goal[]) {

        super({
            ...TagGoal.definition,
            ...getGoalDefintionFrom(goalDetailsOrUniqueName, DefaultGoalNameGenerator.generateName("tag")),
            displayName: "tag",
        }, ...dependsOn);

        this.addFulfillment({
            name: DefaultGoalNameGenerator.generateName("tag"),
            goalExecutor: executeTag(),
        });
    }
}