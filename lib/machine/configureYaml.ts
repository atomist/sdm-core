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

import { Configuration } from "@atomist/automation-client";
import {
    and,
    Goal,
    hasFile,
    ImmaterialGoals,
    Locking,
    not,
    or,
    pushTest,
    PushTest,
    SoftwareDeliveryMachine,
    ToDefaultBranch,
} from "@atomist/sdm";
import * as camelcaseKeys from "camelcase-keys";
import * as fs from "fs-extra";
import * as glob from "glob";
import * as yaml from "js-yaml";
import * as _ from "lodash";
import * as path from "path";
import * as trace from "stack-trace";
import * as util from "util";
import { container } from "../goal/container/container";
import { toArray } from "../util/misc/array";
import {
    configure,
    ConfigureMachineOptions,
    DeliveryGoals,
    GoalConfigurer,
    GoalCreator,
    GoalData,
} from "./configure";

/**
 * Modify the passed GoalData instance or register commands, events with the SDM
 */
export type GoalDataProcessor = (goals: GoalData, sdm: SoftwareDeliveryMachine) => Promise<GoalData>;

/**
 * Configuration options for the yaml support
 */
export interface ConfigureYamlOptions<G extends DeliveryGoals> {
    options?: ConfigureMachineOptions;

    tests?: Record<string, PushTest>;

    goals?: GoalCreator<G>;
    configurers?: GoalConfigurer<G> | Array<GoalConfigurer<G>>;
    // process?: GoalDataProcessor;
}

/**
 * Load one or more yaml files to create goal sets
 *
 * When providing more than one yaml file, files are being loaded
 * in provided order with later files overwriting earlier ones.
 */
export async function configureYaml<G extends DeliveryGoals>(patterns: string | string[],
                                                             options: ConfigureYamlOptions<G> = {}): Promise<Configuration> {
    // Get the caller of this function to determine the cwd for resolving glob patterns
    const callerCallSite = trace.get().filter(t => t.getFileName() !== __filename)
        .filter(t => !!t.getFileName())[0];
    const cwd = path.dirname(callerCallSite.getFileName());

    return configure<G>(async sdm => {

        const additionalGoals = options.goals ? await sdm.createGoals(options.goals, options.configurers) : {};
        const files = await resolveFiles(cwd, patterns);

        const goalData: GoalData = {};

        for (const file of files) {

            const configs = yaml.safeLoadAll(
                await fs.readFile(
                    path.join(cwd, file),
                    { encoding: "UTF-8" },
                ));

            for (const config of configs) {
                if (!!config.name) {
                    (sdm as any).name = config.name;
                }

                if (!!config.configuration) {
                    _.merge(sdm.configuration, config.configuration);
                }

                _.forEach(config, (value: any, k) => {

                    // Ignore two special keys used to set up the SDM
                    if (k === "name" || k === "configuration") {
                        return;
                    }

                    const v = camelcaseKeys(value, { deep: true }) as any;
                    const test = mapTests(v.test, options.tests || {});
                    const goals = mapGoals(v.goals, additionalGoals, cwd);
                    const dependsOn = v.dependsOn;

                    goalData[k] = {
                        test: toArray(test).length > 0 ? test : undefined,
                        dependsOn,
                        goals,
                    };
                });
            }
        }

        // If provided, call the callback so that GoalData can be further configured in code
        /* if (!!options.process) {
            return options.process(goalData, sdm);
        } */

        return goalData;
    }, options.options || {});
}

export function mapTests(tests: any,
                  additionalTests: Record<string, PushTest>): PushTest | PushTest[] {
    return toArray(tests || []).map(t => mapTest(t, additionalTests));
}

export function mapTest(test: any,
                        additionalTests: Record<string, PushTest>): PushTest {
    if (test.hasFile) {
        return hasFile(test.hasFile);
    } else if (test === "isDefaultBranch" || test === "ToDefaultBranch") {
        return ToDefaultBranch;
    } else if (typeof test === "function") {
        return pushTest(test.toString(), test);
    } else if (test.not) {
        return not(mapTest(test.not, additionalTests));
    } else if (test.and) {
        return and(...toArray(mapTests(test.and, additionalTests)));
    } else if (test.or) {
        return or(...toArray(mapTests(test.or, additionalTests)));
    } else if (!!additionalTests[test]) {
        return additionalTests[test];
    }
    throw new Error(`Unable to construct push test from '${JSON.stringify(test)}'`);
}

function mapGoals(goals: any, additionalGoals: DeliveryGoals, cwd: string): Goal | Goal[] {
    if (Array.isArray(goals)) {
        return toArray(goals).map(g => mapGoals(g, additionalGoals, cwd)) as Goal[];
    } else {
        if (!!goals.containers) {
            return container(
                _.get(goals, "containers.name") || _.get(goals, "containers[0].name"),
                {
                    containers: toArray(goals.containers),
                    input: goals.input,
                    output: goals.output,
                });
        } else if (goals.script) {
            const script = goals.script;
            return container(
                script.name,
                {
                    name: script.name,
                    containers: [{
                        name: script.name,
                        image: script.image || "ubuntu:latest",
                        command: script.command,
                        args: script.args,
                    }],
                    input: goals.input,
                    output: goals.output,
                });
            /* } else if (goals.aspect) {
                const aspect = goals.aspect;
                return container(
                    aspect.name,
                    {
                        containers: [{
                            name: aspect.name,
                            image: aspect.image ? aspect.image : "ubuntu:latest",
                            command: !!aspect.extract ? ["sh", "-c"] : undefined,
                            args: !!aspect.extract ? ["/atm/home/extract.sh"] : undefined,
                        }],
                    })
                    .withProjectListener({
                        name: "aspect-extract",
                        listener: async p => {
                            if (!!aspect.extract) {
                                const extractSh = (await fs.readFile(path.join(cwd, aspect.extract || "extract.sh"))).toString();
                                await p.addFile("extract.sh", extractSh);
                                await p.makeExecutable("extract.sh");
                            }
                        },
                        events: [GoalProjectListenerEvent.before],
                    })
                    .withProjectListener({
                        name: "aspect-upload",
                        listener: async (p, r) => {
                            const fingerprints = await p.getFile("fingerprints.json");
                            const fps = JSON.parse(await fingerprints.getContent()) as FP[];
                            await sendFingerprintsToAtomistFor(r, [], r.id as any, fps, {});
                        },
                        events: [GoalProjectListenerEvent.after],
                    }); */
        } else if (goals === "immaterial") {
            return ImmaterialGoals.andLock().goals;
        } else if (goals === "lock") {
            return Locking;
        } else if (additionalGoals[goals]) {
            return additionalGoals[goals];
        }
    }
    throw new Error(`Unable to construct goal from '${JSON.stringify(goals)}'`);
}

async function resolveFiles(cwd: string, patterns: string | string[]): Promise<string[]> {
    const files = [];
    for (const pattern of toArray(patterns)) {
        files.push(...await util.promisify(glob)(pattern, { cwd }));
    }
    return files;
}
