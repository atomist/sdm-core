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
    ConfigurationPostProcessor,
} from "@atomist/automation-client";
import {
    allSatisfied,
    AnyPush,
    Goal,
    GoalContribution,
    goals,
    Goals,
    PushListenerInvocation,
    PushTest,
    SdmContext,
    SoftwareDeliveryMachine,
    whenPushSatisfies,
} from "@atomist/sdm";
import * as _ from "lodash";
import {
    ConfigureOptions,
    configureSdm,
} from "../internal/machine/configureSdm";
import { toArray } from "../util/misc/array";
import { createSoftwareDeliveryMachine } from "./machineFactory";

/**
 * Data structure to configure goal contributions
 */
export interface GoalStructure {

    /**
     * Optional push tests to determine when to schedule provided goals
     *
     * If an array of push tests is provided, they will get wrapped with allSatisfied/and.
     */
    test?: PushTest | PushTest[];

    /** Optional pre conditions for goals; can be actual goal instances or names of goal contributions */
    dependsOn?: string | Goal | Array<string | Goal>;

    /**
     * Goal instances to schedule
     *
     * The following cases are supported:
     *
     * goals: [
     *  autofix,
     *  build
     * ]
     *
     * This means autofix will run after build
     *
     * goals: [
     *  [autofix, build]
     * ]
     *
     * This will schedule autofix and build concurrently
     *
     * goals: [
     *  [autofix, build],
     *  dockerBuild
     * ]
     *
     * This will schedule autofix and build concurrently and dockerBuild once autofix and build are completed
     */
    goals: Goal | Goals | Array<Goal | Goals | Array<Goal | Goals>>;
}

/**
 * Type to collect named GoalStructure instances
 *
 * The record key will be used to name the goal contribution.
 */
export type GoalData = Record<string, GoalStructure>;

/**
 * Configure a SoftwareDeliveryMachine instance by adding command, events etc and optionally returning
 * GoalData, an array of GoalContributions or void when no goals should be added to this SDM.
 */
export type Configurer<F extends SdmContext = PushListenerInvocation> = (sdm: SoftwareDeliveryMachine) =>
    Promise<void | GoalData | Array<GoalContribution<F>>>;

/**
 * Function to create an SDM configuration constant to be exported from an index.ts/js.
 */
export function configure<T extends SdmContext = PushListenerInvocation>(
    configurer: Configurer<T>,
    options: {
        name?: string,
        postProcessors?: ConfigurationPostProcessor | ConfigurationPostProcessor[],
        configuration?: Configuration,
    } & ConfigureOptions = {}): Configuration {
    return {
        postProcessors: [
            ...(toArray(options.postProcessors || [])),
            configureSdm(async cfg => {

                // Modify the configuration before creating the SDM instance
                if (!!options.configuration) {
                    _.merge(cfg, options.configuration);
                }

                const sdm = createSoftwareDeliveryMachine(
                    {
                        name: options.name || cfg.name,
                        configuration: cfg,
                    });

                const configured = await configurer(sdm);

                if (Array.isArray(configured)) {
                    sdm.withPushRules(configured[0], ...configured.slice(1));
                } else if (!!configured) {
                    const goalContributions = convertGoalData(configured);
                    if (goalContributions.length > 0) {
                        sdm.withPushRules(goalContributions[0], ...(goalContributions.slice(1) || []));
                    }
                }

                return sdm;
            }, options),
        ],
    };
}

/**
 * Convert the provided GoalData instance into an array of GoalContributions
 */
export function convertGoalData(goalData: GoalData): Array<GoalContribution<any>> {
    const goalContributions: Array<GoalContribution<any>> = [];

    _.forEach(goalData, (v, k) => {
        (v as any).__goals = [];

        const gs = goals(k.replace(/_/g, " "));
        let lg: Array<Goal | Goals>;

        if (!!v.dependsOn) {
            lg = [];
            toArray(v.dependsOn).forEach(d => {
                if (typeof d === "string") {
                    if (!!goalData[d] && !!(goalData[d] as any).__goals) {
                        lg.push(...(goalData[d] as any).__goals);
                    } else {
                        throw new Error(
                            `Provided dependsOn goals with name '${d}' do not exist or is after current goals named '${k}'`);
                    }
                } else {
                    lg.push(...toArray(d));
                }
            });
        }

        toArray(v.goals || []).forEach(g => {
            (v as any).__goals.push(...(Array.isArray(g) ? (g) : [g]));
            if (!!lg) {
                gs.plan(...convertGoals(g)).after(...convertGoals(lg));
            } else {
                gs.plan(...convertGoals(g));
            }
            lg = toArray(g);
        });

        goalContributions.push(whenPushSatisfies(convertPushTest(v.test)).setGoals(gs));
    });

    return goalContributions;
}

function convertPushTest(test: PushTest | PushTest[]): PushTest {
    if (Array.isArray(test)) {
        return allSatisfied(...test);
    } else {
        return test || AnyPush;
    }
}

function convertGoals(gs: Goal | Goals | Array<Goal | Goals>): Array<Goal | Goals> {
    if (Array.isArray(gs)) {
        return gs;
    } else {
        return [gs];
    }
}
