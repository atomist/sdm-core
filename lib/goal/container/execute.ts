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
    DefaultGoalNameGenerator,
    doWithProject,
    goal,
    GoalWithFulfillment,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as _ from "lodash";
import { resolvePlaceholder } from "../../machine/yaml/mapGoals";
import {
    ContainerProgressReporter,
    ContainerSecrets,
} from "./container";
import { prepareSecrets } from "./provider";

export interface ExecuteRegistration {
    cmd: string;
    args: string | string[];
    secrets?: ContainerSecrets;
}

export function execute(name: string,
                        registration: ExecuteRegistration): GoalWithFulfillment {
    const uniqueName = name.replace(/ /g, "-");
    const executeGoal = goal(
        { displayName: name, uniqueName: DefaultGoalNameGenerator.generateName(uniqueName) },
        doWithProject(async gi => {
            // Resolve placeholders
            const registrationToUse = _.cloneDeep(registration);
            await resolvePlaceholders(
                registrationToUse,
                value => resolvePlaceholder(value, gi.goalEvent, gi, {}));

            // Mount the secrets
            let secrets;
            const secretEnvs = {};
            if (!!registrationToUse.secrets) {
                secrets = await prepareSecrets({ secrets: registrationToUse.secrets }, gi);
                secrets.env.forEach(e => secretEnvs[e.name] = e.value);
                for (const f of secrets.files) {
                    await fs.writeFile(f.mountPath, f.value);
                }
            }

            try {
                return gi.spawn(
                    registrationToUse.cmd,
                    registrationToUse.args,
                    { env: { ...process.env, ...secretEnvs } });
            } finally {
                // Cleanup secrets;
                if (!!secrets) {
                    for (const f of secrets.files) {
                        await fs.unlink(f.mountPath);
                    }
                }
            }
        }, {
            readOnly: false,
            detachHead: true,
        }), { progressReporter: ContainerProgressReporter });
    return executeGoal;
}
