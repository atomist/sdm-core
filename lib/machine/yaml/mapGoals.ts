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
    GitProject,
    HttpMethod,
} from "@atomist/automation-client";
import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import {
    allSatisfied,
    Cancel,
    Goal,
    ImmaterialGoals,
    Locking,
    PushTest,
    Queue,
    RepoContext,
    SdmGoalEvent,
    SoftwareDeliveryMachine,
    StatefulPushListenerInvocation,
} from "@atomist/sdm";
import * as camelcaseKeys from "camelcase-keys";
import * as changeCase from "change-case";
import * as yaml from "js-yaml";
import * as _ from "lodash";
import * as os from "os";
import {
    container,
    Container,
    ContainerProgressReporter,
    ContainerRegistration,
    ContainerSpecCallback,
    GoalContainerSpec,
} from "../../goal/container/container";
import { getGoalVersion } from "../../internal/delivery/build/local/projectVersioner";
import { toArray } from "../../util/misc/array";
import { DeliveryGoals } from "../configure";
import {
    mapTests,
    PushTestMaker,
} from "./mapPushTests";

export type GoalMaker<G extends Record<string, any> = {}> =
    (sdm: SoftwareDeliveryMachine, params: G) => Promise<Goal> | Goal;

// tslint:disable-next-line:cyclomatic-complexity
export async function mapGoals(sdm: SoftwareDeliveryMachine,
                               goalStructure: any,
                               additionalGoals: DeliveryGoals,
                               goalMakers: Record<string, GoalMaker>,
                               additionalTests: Record<string, PushTest>,
                               extensionTests: Record<string, PushTestMaker>): Promise<Goal | Goal[]> {
    if (Array.isArray(goalStructure)) {
        const newGoals: any[] = [];
        for (const g of toArray(goalStructure)) {
            newGoals.push(await mapGoals(sdm, g, additionalGoals, goalMakers, additionalTests, extensionTests));
        }
        return newGoals;
    } else {
        const goals = typeof goalStructure !== "string" ? camelcaseKeys(goalStructure, { deep: true }) : goalStructure as any;
        let goal;
        if (!!goals.containers) {
            const containers = [];
            const name = _.get(goals, "containers.name") || _.get(goals, "containers[0].name");
            for (const gc of goals.containers) {
                containers.push({
                    ...gc,
                    name: gc.name.replace(/ /g, "-"),
                    test: !!gc.test ? await mapTests(gc.test, additionalTests, extensionTests) : undefined,
                });
            }
            goal = container(
                name,
                {
                    callback: containerCallback(),
                    containers,
                    volumes: toArray(goals.volumes),
                    input: goals.input,
                    output: goals.output,
                    progressReporter: ContainerProgressReporter,
                    parameters: goals.parameters,
                });
        } else if (goals === "immaterial") {
            return ImmaterialGoals.andLock().goals;
        } else if (goals === "lock") {
            return Locking;
        } else if (goals === "queue" || goals.queue) {
            return new Queue(typeof goals !== "string" ? goals.queue : undefined);
        } else if (goals.cancel) {
            return new Cancel({ goals: [], goalNames: toArray(goals.cancel) });
        } else if (!!additionalGoals[goals]) {
            goal = additionalGoals[goals];
        } else if (typeof goals === "string" && goals.includes("/")) {
            const referencedGoal = await mapReferencedGoal(sdm, goals, {});
            if (!!referencedGoal) {
                goal = await mapGoals(
                    sdm,
                    referencedGoal,
                    additionalGoals,
                    goalMakers,
                    additionalTests,
                    extensionTests);
            }
        } else {
            for (const goalName in goalStructure) {
                if (goalStructure.hasOwnProperty(goalName) && goalName.includes("/")) {
                    const parameters = goalStructure[goalName].parameters || {};
                    const referencedGoal = await mapReferencedGoal(sdm, goalName, parameters);
                    if (!!referencedGoal) {
                        goal = await mapGoals(
                            sdm,
                            _.merge({}, referencedGoal, goalStructure[goalName] || {}),
                            additionalGoals,
                            goalMakers,
                            additionalTests,
                            extensionTests);
                    }
                }
            }

            for (const goalMakerName in goalMakers) {
                if (!!goals[goalMakerName] || goalMakerName === goals) {
                    goal = await goalMakers[goalMakerName](sdm, goals[goalMakerName] || {}) as any;
                    if (!!goal) {
                        break;
                    }
                }
            }
        }
        if (!!goal) {
            addDetails(goal, goals);
            return goal;
        }
    }

    throw new Error(`Unable to construct goal from '${JSON.stringify(goalStructure)}'`);
}

function addDetails(goal: Goal, goals: any): void {
    (goal as any).definition = _.cloneDeep(goal.definition);
    goal.definition.approvalRequired = goals.approval;
    goal.definition.preApprovalRequired = goals.preApproval;
    goal.definition.retryFeasible = goals.retry;
    if (!!goals.descriptions) {
        goal.definition.canceledDescription = goals.descriptions.canceled;
        goal.definition.completedDescription = goals.descriptions.completed;
        goal.definition.failedDescription = goals.descriptions.failed;
        goal.definition.plannedDescription = goals.descriptions.planned;
        goal.definition.requestedDescription = goals.descriptions.requested;
        goal.definition.stoppedDescription = goals.descriptions.stopped;
        goal.definition.waitingForApprovalDescription = goals.descriptions.waitingForApproval;
        goal.definition.waitingForPreApprovalDescription = goals.descriptions.waitingForPreApproval;
        goal.definition.workingDescription = goals.descriptions.inProcess;
    }
}

function containerCallback(): ContainerSpecCallback {
    return async (r, p, g, e, ctx) => {
        const pli: StatefulPushListenerInvocation = {
            ...ctx,
            push: e.push,
            project: p,
        };
        const containersToRemove = [];
        for (const gc of r.containers) {
            let test;
            if (Array.isArray((gc as any).test)) {
                test = allSatisfied(...(gc as any).test);
            } else {
                test = (gc as any).test;
            }
            if (!!test && !(await test.mapping(pli))) {
                containersToRemove.push(gc);
            }
        }
        const registration: ContainerRegistration = {
            ...r,
            containers: r.containers.filter(c => !containersToRemove.includes(c)),
        };
        return resolvePlaceholderContainerSpecCallback(registration, p, g, e, ctx);
    };
}

async function mapReferencedGoal(sdm: SoftwareDeliveryMachine,
                                 goalRef: string,
                                 parameters: Record<string, any>): Promise<any> {
    const regexp = /([a-zA-Z-_]*)\/([a-zA-Z-_]*)(?:\/([a-zA-Z-_]*))?@([a-zA-Z-_0-9\.]*)/i;
    const match = regexp.exec(goalRef);
    if (!match) {
        return undefined;
    }

    const owner = match[1];
    const repo = match[2];
    const goalName = match[3];
    const goalNames = !!goalName ? [goalName] : [repo, repo.replace(/-goal/, "")];
    const ref = match[4];

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/goal.yaml?ref=${ref}`;

    try {
        const cacheKey = `configuration.sdm.goal.definition.cache[${url}]`;
        const cachedDocuments = _.get(sdm, cacheKey);
        let documents;

        if (!!cachedDocuments) {
            documents = cachedDocuments;
        } else {
            const client = sdm.configuration.http.client.factory.create(url);
            const response = await client.exchange<{ content: string }>(url, {
                method: HttpMethod.Get,
                retry: { retries: 0 },
            });
            const content = Buffer.from(response.body.content, "base64").toString();
            documents = yaml.safeLoadAll(content);
            _.set(sdm, cacheKey, documents);
        }

        for (const document of documents) {
            for (const key in document) {
                if (document.hasOwnProperty(key) && goalNames.includes(key)) {
                    const pdg = document[key];
                    await resolvePlaceholders(pdg as any,
                            value => resolvePlaceholder(value, undefined, {} as any, parameters, false));
                    return pdg;
                }
            }
        }
    } catch (e) {
        throw new Error(`Referenced goal '${goalRef}' can not be created: ${e.message}`);
    }
    return undefined;
}

async function resolvePlaceholderContainerSpecCallback(r: ContainerRegistration,
                                                       p: GitProject,
                                                       g: Container,
                                                       e: SdmGoalEvent,
                                                       ctx: RepoContext): Promise<GoalContainerSpec> {
    await resolvePlaceholders(r as any, value => resolvePlaceholder(value, e, ctx, (r as any).parameters));
    return r;
}

const PlaceholderExpression = /\$\{([.a-zA-Z_-]+)([.:0-9a-zA-Z-_ \" ]+)*\}/g;

export async function resolvePlaceholder(value: string,
                                         goal: SdmGoalEvent,
                                         ctx: Pick<RepoContext, "configuration" | "context">,
                                         parameters: Record<string, any>,
                                         raiseError: boolean = true): Promise<string> {
    if (!PlaceholderExpression.test(value)) {
        return value;
    }
    PlaceholderExpression.lastIndex = 0;
    let currentValue = value;
    let result: RegExpExecArray;
    // tslint:disable-next-line:no-conditional-assignment
    while (result = PlaceholderExpression.exec(currentValue)) {
        const fm = result[0];
        let envValue = _.get(goal, result[1]) ||
            _.get(ctx.configuration, result[1]) ||
            _.get(ctx.configuration, camelCase(result[1])) ||
            _.get({ parameters }, result[1]) ||
            _.get({ parameters }, camelCase(result[1]));
        if (result[1] === "home") {
            envValue = os.userInfo().homedir;
        } else if (result[1] === "push.after.version" && !!goal) {
            envValue = await getGoalVersion({
                context: ctx.context,
                owner: goal.repo.owner,
                repo: goal.repo.name,
                providerId: goal.repo.providerId,
                branch: goal.branch,
                sha: goal.sha,
            });
        }
        const defaultValue = result[2] ? result[2].trim().slice(1) : undefined;

        if (typeof envValue === "string") {
            currentValue = currentValue.split(fm).join(envValue);
            PlaceholderExpression.lastIndex = 0;
        } else if (typeof envValue === "object" && value === fm) {
            return envValue;
        } else if (defaultValue) {
            currentValue = currentValue.split(fm).join(defaultValue);
            PlaceholderExpression.lastIndex = 0;
        } else if (raiseError) {
            throw new Error(`Placeholder '${result[1]}' can't be resolved`);
        }
    }
    return currentValue;
}

function camelCase(key: string): string {
    return key.split(".").map(k => changeCase.camel(k)).join(".");
}
