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
    Configuration,
    NoParameters,
} from "@atomist/automation-client";
import { deepMergeConfigs } from "@atomist/automation-client/lib/configuration";
import {
    CommandHandlerRegistration,
    EventHandlerRegistration,
    ExtensionPack,
    PushTest,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
} from "@atomist/sdm";
import * as camelcaseKeys from "camelcase-keys";
import * as changeCase from "change-case";
import * as fs from "fs-extra";
import * as glob from "glob";
import * as yaml from "js-yaml";
import * as _ from "lodash";
import * as path from "path";
import * as trace from "stack-trace";
import * as util from "util";
import { githubGoalStatusSupport } from "../../pack/github-goal-status/github";
import { goalStateSupport } from "../../pack/goal-state/goalState";
import { toArray } from "../../util/misc/array";
import {
    configure,
    ConfigureMachineOptions,
    CreateGoals,
    DeliveryGoals,
    GoalConfigurer,
    GoalCreator,
    GoalData,
} from "../configure";
import {
    GoalMaker,
    mapGoals,
} from "./mapGoals";
import {
    mapTests,
    PushTestMaker,
} from "./mapPushTests";
import { watchPaths } from "./util";

export interface YamlSoftwareDeliveryMachineConfiguration {
    extensionPacks?: ExtensionPack[];
    extensions?: {
        commands?: string[];
        events?: string[];
        ingesters?: string[];

        goals?: string[];
        tests?: string[];
    };
}

export type CommandHandler<PARAMS = NoParameters> =
    Omit<CommandHandlerRegistration<PARAMS>, "name">;
export type CommandMaker<PARAMS = NoParameters> =
    (sdm: SoftwareDeliveryMachine) => Promise<CommandHandler<PARAMS>> | CommandHandler<PARAMS>;
export type EventHandler<PARAMS = NoParameters> =
    Omit<EventHandlerRegistration<PARAMS>, "name">;
export type EventMaker<PARAMS = NoParameters> =
    (sdm: SoftwareDeliveryMachine) => Promise<EventHandler<PARAMS>> | EventHandler<PARAMS>;

export type ConfigurationMaker = (cfg: Configuration) =>
    Promise<SoftwareDeliveryMachineConfiguration<YamlSoftwareDeliveryMachineConfiguration>> |
    SoftwareDeliveryMachineConfiguration<YamlSoftwareDeliveryMachineConfiguration>;

/**
 * Configuration options for the yaml support
 */
export interface ConfigureYamlOptions<G extends DeliveryGoals> {
    options?: ConfigureMachineOptions;

    tests?: Record<string, PushTest>;

    goals?: GoalCreator<G>;
    configurers?: GoalConfigurer<G> | Array<GoalConfigurer<G>>;
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

    const cfg = await createConfiguration(cwd, options);

    return configure<G>(async sdm => {
        await createExtensions(cwd, cfg, sdm);
        return createGoalData(patterns, cwd, options, cfg, sdm);
    }, options.options || {});
}

async function createConfiguration(cwd: string, options: ConfigureYamlOptions<any>)
    : Promise<YamlSoftwareDeliveryMachineConfiguration> {
    const cfg: any = {};
    await awaitIterable(await requireConfiguration(cwd), async v => {
        const c = await v(cfg);
        deepMergeConfigs(cfg, c);
    });
    _.update(options, "options.preProcessors",
        old => !!old ? old : []);
    options.options.preProcessors = [
        async c => deepMergeConfigs(c, cfg) as any,
        ...toArray(options.options.preProcessors),
    ];
    return cfg;
}

async function createExtensions(cwd: string,
                                cfg: YamlSoftwareDeliveryMachineConfiguration,
                                sdm: SoftwareDeliveryMachine): Promise<void> {
    await awaitIterable(
        await requireCommands(cwd, _.get(cfg, "extensions.commands")),
        async (c, k) => sdm.addCommand({ name: k, ...(await c(sdm)) }));
    await awaitIterable(
        await requireEvents(cwd, _.get(cfg, "extensions.events")),
        async (e, k) => sdm.addEvent({ name: k, ...(await e(sdm)) }));
    await requireIngesters(cwd, _.get(cfg, "extensions.ingesters"));
    sdm.addExtensionPacks(...(sdm.configuration.sdm?.extensionPacks || [
        goalStateSupport({
            cancellation: {
                enabled: true,
            },
        }),
        githubGoalStatusSupport(),
    ]));
}

async function createGoalData<G extends DeliveryGoals>(patterns: string | string[],
                                                       cwd: string,
                                                       options: ConfigureYamlOptions<G>,
                                                       cfg: YamlSoftwareDeliveryMachineConfiguration,
                                                       sdm: SoftwareDeliveryMachine & { createGoals: CreateGoals<G> })
    : Promise<GoalData> {
    const additionalGoals = options.goals ? await sdm.createGoals(options.goals, options.configurers) : {};
    const goalMakers = await requireGoals(cwd, _.get(cfg, "extensions.goals"));
    const testMakers = await requireTests(cwd, _.get(cfg, "extensions.tests"));

    const files = await resolvePaths(cwd, patterns, true);

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
                _.merge(sdm.configuration, camelcaseKeys(config.configuration, { deep: true }));
            }

            for (const k in config) {
                if (config.hasOwnProperty(k)) {
                    const value = config[k];

                    // Ignore two special keys used to set up the SDM
                    if (k === "name" || k === "configuration") {
                        continue;
                    }

                    const test = await mapTests(value.test, options.tests || {}, testMakers);
                    const goals = await mapGoals(sdm, value.goals, additionalGoals, goalMakers, options.tests || {}, testMakers);
                    const dependsOn = value.dependsOn || value.depends_on;

                    goalData[k] = {
                        test: toArray(test).length > 0 ? test : undefined,
                        dependsOn,
                        goals,
                    };
                }
            }
        }
    }

    return goalData;
}

async function requireExtensions<EXT>(cwd: string,
                                      pattern: string[],
                                      cb: (v: EXT, k: string, e: Record<string, EXT>) => void = () => {
                                      }): Promise<Record<string, EXT>> {
    const extensions: Record<string, EXT> = {};
    const files = await resolvePaths(cwd, pattern);
    for (const file of files) {
        const testJs = require(`${cwd}/${file}`);
        _.forEach(testJs, (v: EXT, k: string) => {
            if (!!cb) {
                cb(v, k, extensions);
            }
            extensions[k] = v;
        });
    }
    return extensions;
}

async function requireTests(cwd: string, pattern: string[] = ["tests/**.js", "lib/tests/**.js"])
    : Promise<Record<string, PushTestMaker>> {
    return requireExtensions<PushTestMaker>(cwd, pattern, (v, k, e) => e[changeCase.snake(k)] = v);
}

async function requireGoals(cwd: string, pattern: string[] = ["goals/**.js", "lib/goals/**.js"])
    : Promise<Record<string, GoalMaker>> {
    return requireExtensions<GoalMaker>(cwd, pattern, (v, k, e) => e[changeCase.snake(k)] = v);
}

async function requireCommands(cwd: string, pattern: string[] = ["commands/**.js", "lib/commands/**.js"])
    : Promise<Record<string, CommandMaker>> {
    return requireExtensions<CommandMaker>(cwd, pattern);
}

async function requireEvents(cwd: string, pattern: string[] = ["events/**.js", "lib/events/**.js"])
    : Promise<Record<string, EventMaker>> {
    return requireExtensions<EventMaker>(cwd, pattern);
}

async function requireConfiguration(cwd: string, pattern: string[] = ["config.js", "lib/config.js"])
    : Promise<Record<string, ConfigurationMaker>> {
    return requireExtensions<ConfigurationMaker>(cwd, pattern);
}

async function requireIngesters(cwd: string, pattern: string[] = ["ingesters/**.graphql", "lib/graphql/ingester/**.graphql"])
    : Promise<string[]> {
    const ingesters: string[] = [];
    const files = await resolvePaths(cwd, pattern);
    for (const file of files) {
        ingesters.push((await fs.readFile(file)).toString());
    }
    return ingesters;
}

async function awaitIterable<G>(elems: Record<string, G>,
                                cb: (v: G, k: string) => Promise<any>): Promise<void> {
    for (const k in elems) {
        if (elems.hasOwnProperty(k)) {
            const v = elems[k];
            await cb(v, k);
        }
    }
}

async function resolvePaths(cwd: string, patterns: string | string[], watch: boolean = false): Promise<string[]> {
    const paths = [];
    for (const pattern of toArray(patterns)) {
        paths.push(...await util.promisify(glob)(pattern, { cwd }));
    }
    if (watch) {
        watchPaths(paths);
    }
    return paths;
}
