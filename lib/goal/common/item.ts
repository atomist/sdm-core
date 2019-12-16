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

import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import {
    goal,
    GoalWithFulfillment,
    Parameterized,
} from "@atomist/sdm";
import { resolvePlaceholder } from "../../machine/yaml/resolvePlaceholder";
import { CacheEntry } from "../cache/goalCaching";
import { ContainerSecrets } from "../container/container";

export function item(name: string,
                     registration: string,
                     options: {
                         uniqueName?: string,
                         parameters?: Parameterized,
                         input?: Array<{ classifier: string }>,
                         output?: CacheEntry[],
                         secrets?: ContainerSecrets,
                     } = {}): GoalWithFulfillment {
    const { uniqueName, parameters, input, output, secrets } = options;
    const g = goal({ displayName: uniqueName, uniqueName: uniqueName || name }).with({
        name: name.replace(/ /g, "_"),
        registration,
    });
    if (!!parameters || !!input || !!output || !!secrets) {
        g.plan = async pli => {
            const { push } = pli;
            await resolvePlaceholders(parameters, v => resolvePlaceholder(v, {
                sha: pli.push.after.sha,
                branch: pli.push.branch,
                repo: {
                    owner: push.repo.owner,
                    name: push.repo.name,
                    providerId: push.repo.org.provider.providerId,
                },
                push: pli.push,
            } as any, pli, {}, true));

            return {
                parameters: {
                    ...(parameters || {}),
                    "@atomist/sdm/input": input,
                    "@atomist/sdm/output": output,
                    "@atomist/sdm/secrets": secrets,
                },
            };
        };
    }
    return g;
}
