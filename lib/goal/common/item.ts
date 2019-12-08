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
    goal,
    GoalWithFulfillment,
    Parameterized,
} from "@atomist/sdm";
import { CacheEntry } from "../cache/goalCaching";

export function item(name: string,
                     registration: string,
                     options: {
                         uniqueName?: string,
                         parameters?: Parameterized,
                         input?: Array<{ classifier: string }>,
                         output?: CacheEntry[],
                     } = {}): GoalWithFulfillment {
    const { uniqueName, parameters, input, output } = options;
    const g = goal({ displayName: uniqueName, uniqueName: uniqueName || name }).with({
        name: name.replace(/ /g, "_"),
        registration,
    });
    if (!!parameters || !!input || !!output) {
        g.plan = async () => ({
            parameters: {
                ...(parameters || {}),
                input,
                output,
            },
        });
    }
    return g;
}
