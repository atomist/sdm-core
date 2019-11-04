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
    GitProject,
    HandlerContext,
    NoParameters,
} from "@atomist/automation-client";
import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import {
    and,
    CommandHandlerRegistration,
    EventHandlerRegistration,
    Goal,
    hasFile,
    ImmaterialGoals,
    Locking,
    not,
    or,
    pushTest,
    PushTest,
    SdmGoalEvent,
    SoftwareDeliveryMachine,
    StatefulPushListenerInvocation,
    ToDefaultBranch,
} from "@atomist/sdm";
import * as camelcaseKeys from "camelcase-keys";
import * as fs from "fs-extra";
import * as glob from "glob";
import * as yaml from "js-yaml";
import * as _ from "lodash";
import * as os from "os";
import * as path from "path";
import * as trace from "stack-trace";
import * as util from "util";
import {
    container,
    Container,
    ContainerProgressReporter,
    ContainerRegistration,
    GoalContainerSpec,
} from "../goal/container/container";
import { toArray } from "../util/misc/array";
import {
    configure,
    ConfigureMachineOptions,
    DeliveryGoals,
    GoalConfigurer,
    GoalCreator,
    GoalData,
} from "./configure";

export type CommandHandler<PARAMS = NoParameters> = Omit<CommandHandlerRegistration<PARAMS>, "name">;
export type CommandMaker<PARAMS = NoParameters> = (sdm: SoftwareDeliveryMachine) => Promise<CommandHandler<PARAMS>> | CommandHandler<PARAMS>;
export type EventHandler<PARAMS = NoParameters> = Omit<EventHandlerRegistration<PARAMS>, "name">;
export type EventMaker<PARAMS = NoParameters> = (sdm: SoftwareDeliveryMachine) => Promise<EventHandler<PARAMS>> | EventHandler<PARAMS>;

export type PushTestMaker = (params: any) => ((pli: StatefulPushListenerInvocation) => Promise<boolean>) | Promise<PushTest> | PushTest;
export type GoalMaker = (sdm: SoftwareDeliveryMachine) => Promise<Goal> | Goal;

export type ConfigurationMaker = (cfg: Configuration) => Promise<Configuration> | Configuration;

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

    const cfg: any = {};
    await awaitIterable(await createConfiguration(cwd), async v => _.defaultsDeep(cfg, v));
    _.update(options, "options.preProcessors",
        old => !!old ? old : []);
    options.options.preProcessors = [async () => cfg, ...toArray(options.options.preProcessors)];

    return configure<G>(async sdm => {

        await awaitIterable(
            await createCommands(cwd),
            async (c, k) => sdm.addCommand({ name: k, ...(await c(sdm)) }));
        await awaitIterable(
            await createEvents(cwd),
            async (e, k) => sdm.addEvent({ name: k, ...(await e(sdm)) }));

        const additionalGoals = options.goals ? await sdm.createGoals(options.goals, options.configurers) : {};
        const goalMakers = await createGoals(cwd);
        const testMakers = await createTests(cwd);

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

                for (const k in config) {
                    if (config.hasOwnProperty(k)) {
                        const value = config[k];

                        // Ignore two special keys used to set up the SDM
                        if (k === "name" || k === "configuration") {
                            continue;
                        }

                        const v = camelcaseKeys(value, { deep: true }) as any;
                        const test = await mapTests(v.test, options.tests || {}, testMakers);
                        const goals = await mapGoals(sdm, v.goals, additionalGoals, goalMakers, cwd);
                        const dependsOn = v.dependsOn;

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
    }, options.options || {});
}

export async function mapTests(tests: any,
                         additionalTests: Record<string, PushTest>,
                         extensionTests: Record<string, PushTestMaker>): Promise<PushTest | PushTest[]> {
    const newTests = [];
    for (const t of toArray(tests)) {
        newTests.push(await mapTest(t, additionalTests, extensionTests));
    }
    return newTests;
}

export async function mapTest(test: any,
                        additionalTests: Record<string, PushTest>,
                        extensionTests: Record<string, PushTestMaker>): Promise<PushTest> {
    if (test.hasFile) {
        return hasFile(test.hasFile);
    } else if (test === "isDefaultBranch" || test === "ToDefaultBranch") {
        return ToDefaultBranch;
    } else if (typeof test === "function") {
        return pushTest(test.toString(), test);
    } else if (test.not) {
        return not(await mapTest(test.not, additionalTests, extensionTests));
    } else if (test.and) {
        return and(...toArray(await mapTests(test.and, additionalTests, extensionTests)));
    } else if (test.or) {
        return or(...toArray(await mapTests(test.or, additionalTests, extensionTests)));
    } else if (typeof test === "string" && !!additionalTests[test]) {
        return additionalTests[test];
    } else {
        for (const extTestName in extensionTests) {
            if (!!test[extTestName] || extTestName === test) {
                const extTest = await extensionTests[extTestName](test[extTestName]) as any;
                if (!!extTest.name && !!extTest.mapping) {
                    return extTest;
                } else {
                    return pushTest(extTestName, extTest);
                }
            }
        }
    }
    throw new Error(`Unable to construct push test from '${JSON.stringify(test)}'`);
}

async function mapGoals(sdm: SoftwareDeliveryMachine,
                        goals: any,
                        additionalGoals: DeliveryGoals,
                        goalMakers: Record<string, GoalMaker>,
                        cwd: string): Promise<Goal | Goal[]> {
    if (Array.isArray(goals)) {
        const newGoals: any[] = [];
        for (const g of toArray(goals)) {
            newGoals.push(await mapGoals(sdm, g, additionalGoals, goalMakers, cwd));
        }
        return newGoals;
    } else {
        if (!!goals.containers) {
            return container(
                _.get(goals, "containers.name") || _.get(goals, "containers[0].name"),
                {
                    callback: resolvePlaceholderContainerSpecCallback,
                    containers: toArray(goals.containers),
                    volumes: toArray(goals.volumes),
                    input: goals.input,
                    output: goals.output,
                    progressReporter: ContainerProgressReporter,
                });
        } else if (goals.script) {
            const script = goals.script;
            return container(
                script.name,
                {
                    callback: resolvePlaceholderContainerSpecCallback,
                    name: script.name,
                    containers: [{
                        name: script.name,
                        image: script.image || "ubuntu:latest",
                        command: script.command,
                        args: script.args,
                    }],
                    input: goals.input,
                    output: goals.output,
                    progressReporter: ContainerProgressReporter,
                });
        } else if (goals === "immaterial") {
            return ImmaterialGoals.andLock().goals;
        } else if (goals === "lock") {
            return Locking;
        } else if (!!additionalGoals[goals]) {
            return additionalGoals[goals];
        } else if (!!goalMakers[goals]) {
            return await goalMakers[goals](sdm);
        }
    }
    throw new Error(`Unable to construct goal from '${JSON.stringify(goals)}'`);
}

async function requireExtensions<EXT>(cwd: string, pattern: string[]): Promise<Record<string, EXT>> {
    const extensions: Record<string, EXT> = {};
    const files = await resolveFiles(cwd, pattern);
    for (const file of files) {
        const testJs = require(`${cwd}/${file}`);
        _.forEach(testJs, (v, k) => extensions[k] = v);
    }
    return extensions;
}

async function createTests(cwd: string, pattern: string[] = ["tests/**.js", "lib/tests/**.js"])
    : Promise<Record<string, PushTestMaker>> {
    return requireExtensions<PushTestMaker>(cwd, pattern);
}

async function createGoals(cwd: string, pattern: string[] = ["goals/**.js", "lib/goals/**.js"])
    : Promise<Record<string, GoalMaker>> {
    return requireExtensions<GoalMaker>(cwd, pattern);
}

async function createCommands(cwd: string, pattern: string[] = ["commands/**.js", "lib/commands/**.js"])
    : Promise<Record<string, CommandMaker>> {
    return requireExtensions<CommandMaker>(cwd, pattern);
}

async function createEvents(cwd: string, pattern: string[] = ["events/**.js", "lib/events/**.js"])
    : Promise<Record<string, EventMaker>> {
    return requireExtensions<EventMaker>(cwd, pattern);
}

async function createConfiguration(cwd: string, pattern: string[] = ["config.js", "lib/config.js"])
    : Promise<Record<string, ConfigurationMaker>> {
    return requireExtensions<ConfigurationMaker>(cwd, pattern);
}

async function awaitIterable<G>(elems: Record<string, G>, cb: (v, k) => Promise<any>): Promise<void> {
    for (const k in elems) {
        if (elems.hasOwnProperty(k)) {
            const v = elems[k];
            await cb(v, k);
        }
    }
}

async function resolveFiles(cwd: string, patterns: string | string[]): Promise<string[]> {
    const files = [];
    for (const pattern of toArray(patterns)) {
        files.push(...await util.promisify(glob)(pattern, { cwd }));
    }
    return files;
}

async function resolvePlaceholderContainerSpecCallback(r: ContainerRegistration,
                                                       p: GitProject,
                                                       g: Container,
                                                       e: SdmGoalEvent,
                                                       c: HandlerContext): Promise<GoalContainerSpec> {
    await resolvePlaceholders(r as any, value => resolvePlaceholder(value, e));
    return r;
}

const PlaceholderExpression = /\$\{([.a-zA-Z_-]+)([.:0-9a-zA-Z-_ \" ]+)*\}/g;

async function resolvePlaceholder(value: string, goal: SdmGoalEvent): Promise<string> {
    if (!PlaceholderExpression.test(value)) {
        return value;
    }
    PlaceholderExpression.lastIndex = 0;
    let currentValue = value;
    let result: RegExpExecArray;
    // tslint:disable-next-line:no-conditional-assignment
    while (result = PlaceholderExpression.exec(currentValue)) {
        const fm = result[0];
        let envValue = _.get(goal, result[1]);
        if (result[1] === "home") {
            envValue = os.userInfo().homedir;
        }
        const defaultValue = result[2] ? result[2].trim().slice(1) : undefined;

        if (envValue) {
            currentValue = currentValue.split(fm).join(envValue);
        } else if (defaultValue) {
            currentValue = currentValue.split(fm).join(defaultValue);
        } else {
            throw new Error(`Placeholder '${result[1]}' can't be resolved`);
        }
        PlaceholderExpression.lastIndex = 0;
    }
    return currentValue;
}
