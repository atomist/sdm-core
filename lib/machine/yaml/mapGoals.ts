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
    GitHubRepoRef,
    GitProject,
    HttpMethod,
    isTokenCredentials,
} from "@atomist/automation-client";
import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import {
    allSatisfied,
    Cancel,
    Goal,
    GoalWithFulfillment,
    ImmaterialGoals,
    Locking,
    PushTest,
    Queue,
    RepoContext,
    SdmGoalEvent,
    SoftwareDeliveryMachine,
    StatefulPushListenerInvocation,
} from "@atomist/sdm";
import * as changeCase from "change-case";
import * as yaml from "js-yaml";
import * as _ from "lodash";
import {
    CacheEntry,
    cachePut,
    cacheRestore,
} from "../../goal/cache/goalCaching";
import { item } from "../../goal/common/item";
import {
    container,
    Container,
    ContainerProgressReporter,
    ContainerRegistration,
    ContainerSpecCallback,
    GoalContainerSpec,
} from "../../goal/container/container";
import { execute } from "../../goal/container/execute";
import { toArray } from "../../util/misc/array";
import { DeliveryGoals } from "../configure";
import {
    mapTests,
    PushTestMaker,
} from "./mapPushTests";
import { resolvePlaceholder } from "./resolvePlaceholder";
import { camelCase } from "./util";

// tslint:disable:max-file-line-count

export type GoalMaker<G extends Record<string, any> = {}> =
    (sdm: SoftwareDeliveryMachine, params: G) => Promise<Goal> | Goal;

type MapGoal = (goals: any,
                sdm: SoftwareDeliveryMachine,
                additionalGoals: DeliveryGoals,
                goalMakers: Record<string, GoalMaker>,
                additionalTests: Record<string, PushTest>,
                extensionTests: Record<string, PushTestMaker>) => Promise<Goal | Goal[]>;

const MapContainer: MapGoal = async (goals: any,
                                     sdm: SoftwareDeliveryMachine,
                                     additionalGoals: DeliveryGoals,
                                     goalMakers: Record<string, GoalMaker>,
                                     additionalTests: Record<string, PushTest>,
                                     extensionTests: Record<string, PushTestMaker>) => {
    let goal: Goal;
    if (!!goals.containers) {
        const containers = [];
        const name = _.get(goals, "containers.name") || _.get(goals, "containers[0].name");
        for (const gc of goals.containers) {
            containers.push({
                ...camelCase(gc),
                name: gc.name.replace(/ /g, "-"),
                test: !!gc.test ? await mapTests(gc.test, additionalTests, extensionTests) : undefined,
            });
        }
        goal = container(
            name,
            {
                callback: containerCallback(),
                containers,
                volumes: camelCase(toArray(goals.volumes)),
                input: toArray(goals.input),
                output: mapOutput(goals),
                progressReporter: ContainerProgressReporter,
                parameters: camelCase(goals.parameters),
            });
    }
    return goal;
};

const MapExecute: MapGoal = async goals => {
    let goal: GoalWithFulfillment;
    if (!!goals.execute) {
        const g = goals.execute;
        goal = execute(g.name, {
            cmd: g.command || g.cmd,
            args: toArray(g.args),
            secrets: camelCase(g.secrets),
        });
        goal = addCaching(goal, g);
    }
    return goal;
};

const MapImmaterial: MapGoal = async goals => {
    if (goals === "immaterial") {
        return ImmaterialGoals.andLock().goals;
    }
    return undefined;
};

const MapLock: MapGoal = async goals => {
    if (goals === "lock") {
        return Locking;
    }
    return undefined;
};

const MapQueue: MapGoal = async goals => {
    if (goals === "queue" || goals.queue) {
        return new Queue(typeof goals !== "string" ? goals.queue : undefined);
    }
    return undefined;
};

const MapCancel: MapGoal = async goals => {
    if (goals.cancel) {
        return new Cancel({ goals: [], goalNames: toArray(goals.cancel) });
    }
    return undefined;
};

const MapAdditional: MapGoal = async (goals: any,
                                      sdm: SoftwareDeliveryMachine,
                                      additionalGoals: DeliveryGoals) => {
    if (!!additionalGoals[goals]) {
        return additionalGoals[goals];
    }
    const camelGoals = changeCase.camel(goals);
    if (!!additionalGoals[camelGoals]) {
        return additionalGoals[camelGoals];
    }
    return undefined;
};

const MapReferenced: MapGoal = async (goals: any,
                                      sdm: SoftwareDeliveryMachine,
                                      additionalGoals: DeliveryGoals,
                                      goalMakers: Record<string, GoalMaker>,
                                      additionalTests: Record<string, PushTest>,
                                      extensionTests: Record<string, PushTestMaker>) => {
    if (typeof goals === "string" && goals.includes("/") && !goals.startsWith("@")) {
        const referencedGoal = await mapReferencedGoal(sdm, goals, {});
        if (!!referencedGoal) {
            return mapGoals(
                sdm,
                referencedGoal,
                additionalGoals,
                goalMakers,
                additionalTests,
                extensionTests);
        }
    }

    for (const goalName in goals) {
        if (goals.hasOwnProperty(goalName) && goalName.includes("/") && !goalName.startsWith("@")) {
            const parameters = camelCase(goals[goalName].parameters || {});
            const referencedGoal = await mapReferencedGoal(sdm, goalName, parameters);
            if (!!referencedGoal) {
                return mapGoals(
                    sdm,
                    _.merge({}, referencedGoal, camelCase(goals[goalName] || {})),
                    additionalGoals,
                    goalMakers,
                    additionalTests,
                    extensionTests);
            }
        }
    }

    return undefined;
};

const MapGoalMakers: MapGoal = async (goals: any,
                                      sdm: SoftwareDeliveryMachine,
                                      additionalGoals: DeliveryGoals,
                                      goalMakers: Record<string, GoalMaker>) => {

    const Mapper = async (goalMakerName: string, goalMaker: GoalMaker) => {
        let g;
        if (!!goals[goalMakerName] || goalMakerName === goals) {
            g = await goalMaker(sdm, camelCase(goals[goalMakerName] || {})) as any;
            if (!!g) {
                g = addCaching(g, goals[goalMakerName] || {});
            }
        }
        return g;
    };

    let goal: GoalWithFulfillment;
    for (const goalMakerName in goalMakers) {
        if (goalMakers.hasOwnProperty(goalMakerName)) {
            const goalMaker = goalMakers[goalMakerName];
            goal = await Mapper(goalMakerName, goalMaker);
            if (!!goal) {
                break;
            } else {
                goal = await Mapper(changeCase.snake(goalMakerName), goalMaker);
                if (!!goal) {
                    break;
                }
            }
        }
    }
    return goal;
};

const MapFulfillment: MapGoal = async (goals: any) => {
    const regexp = /([@a-zA-Z-_]*)\/([a-zA-Z-_]*)(?:\/([a-zA-Z-_]*))?@?([a-zA-Z-_0-9\.]*)/i;
    if (typeof goals === "string" && goals.startsWith("@")) {
        const match = regexp.exec(goals);
        if (!!match) {
            return item(
                match[3].replace(/_/g, " "),
                `${match[1]}/${match[2]}`,
                {
                    uniqueName: match[3],
                });
        }
    }

    for (const name in goals) {
        if (goals.hasOwnProperty(name)) {
            const match = regexp.exec(name);
            if (!!match && name.startsWith("@")) {
                const gd = camelCase(goals[name]);
                const g = item(
                    match[3].replace(/_/g, " "),
                    `${match[1]}/${match[2]}`,
                    {
                        uniqueName: gd.name || match[3],
                        parameters: gd.parameters,
                        input: !!gd.input ? toArray(gd.input).map(c => ({ classifier: c })) : undefined,
                        output: mapOutput(goals[name]),
                    });
                return addDetails(g, goals[name]);
            }
        }
    }

    return undefined;
};

const MapGoals = [
    MapContainer,
    MapExecute,
    MapImmaterial,
    MapLock,
    MapCancel,
    MapQueue,
    MapAdditional,
    MapGoalMakers,
    MapReferenced,
    MapFulfillment,
];

export async function mapGoals(sdm: SoftwareDeliveryMachine,
                               goals: any,
                               additionalGoals: DeliveryGoals,
                               goalMakers: Record<string, GoalMaker>,
                               additionalTests: Record<string, PushTest>,
                               extensionTests: Record<string, PushTestMaker>): Promise<Goal | Goal[]> {
    if (Array.isArray(goals)) {
        const newGoals: any[] = [];
        for (const g of toArray(goals)) {
            newGoals.push(await mapGoals(sdm, g, additionalGoals, goalMakers, additionalTests, extensionTests));
        }
        return newGoals;
    } else {
        let goal;
        for (const mapGoal of MapGoals) {
            goal = await mapGoal(goals, sdm, additionalGoals, goalMakers, additionalTests, extensionTests);
            if (!!goal) {
                break;
            }
        }
        if (!!goal) {
            if (!Array.isArray(goal)) {
                return addDetails(goal, goals);
            } else {
                return goal;
            }
        }
    }

    throw new Error(`Unable to construct goal from '${JSON.stringify(goals)}'`);
}

function addDetails(goal: Goal, goals: any): Goal {
    (goal as any).definition = _.cloneDeep(goal.definition);
    if (goals.approval !== undefined) {
        goal.definition.approvalRequired = goals.approval;
    }
    if (goals.preApproval !== undefined || goals.pre_approval !== undefined) {
        goal.definition.preApprovalRequired = goals.preApproval || goals.pre_approval;
    }
    if (goals.retry !== undefined) {
        goal.definition.retryFeasible = goals.retry;
    }
    if (!!goals.descriptions) {
        const descriptions = camelCase(goals.descriptions);
        goal.definition.canceledDescription = descriptions.canceled;
        goal.definition.completedDescription = descriptions.completed;
        goal.definition.failedDescription = descriptions.failed;
        goal.definition.plannedDescription = descriptions.planned;
        goal.definition.requestedDescription = descriptions.requested;
        goal.definition.stoppedDescription = descriptions.stopped;
        goal.definition.waitingForApprovalDescription = descriptions.waitingForApproval;
        goal.definition.waitingForPreApprovalDescription = descriptions.waitingForPreApproval;
        goal.definition.workingDescription = descriptions.inProcess;
    }
    return goal;
}

function addCaching(goal: GoalWithFulfillment, goals: any): GoalWithFulfillment {
    if (!!goals?.input) {
        goal.withProjectListener(cacheRestore({ entries: toArray(goals.input).map(c => ({ classifier: c })) }));
    }
    if (!!goals?.output) {
        goal.withProjectListener(cachePut({ entries: mapOutput(goals) }));
    }
    return goal;
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

function mapOutput(goals: any): CacheEntry[] {
    if (Array.isArray(goals?.output)) {
        const entries: CacheEntry[] = [];
        for (const entry of goals.output) {
            if (!!entry.classifier) {
                entries.push(camelCase(entry));
            } else {
                entries.push(..._.map(entry, (v, k) => ({
                    ...camelCase(v),
                    classifier: k,
                })));
            }
        }
        return entries;
    } else {
        return _.map(goals?.output || {}, (v, k) => ({
            classifier: k,
            pattern: camelCase(v),
        }));
    }
}

async function mapReferencedGoal(sdm: SoftwareDeliveryMachine,
                                 goalRef: string,
                                 parameters: Record<string, any>): Promise<any> {
    const regexp = /([a-zA-Z-_]*)\/([a-zA-Z-_]*)(?:\/([a-zA-Z-_]*))?@?([a-zA-Z-_0-9\.]*)/i;
    const match = regexp.exec(goalRef);
    if (!match) {
        return undefined;
    }

    const owner = match[1];
    const repo = match[2];
    const goalName = match[3];
    const goalNames = !!goalName ? [goalName] : [repo, repo.replace(/-goal/, "")];
    const ref = match[4] || "master";

    // Check if we have a github token to authenticate our requests
    let token = sdm.configuration?.sdm?.github?.token || sdm.configuration?.sdm?.goal?.yaml?.token;
    if (!token) {
        const workspaceId = _.get(sdm.configuration, "workspaceIds[0]");
        if (!!workspaceId) {
            try {
                const creds = await sdm.configuration.sdm.credentialsResolver.eventHandlerCredentials(
                    { graphClient: sdm.configuration.graphql.client.factory.create(workspaceId, sdm.configuration) } as any, GitHubRepoRef.from({
                        owner: undefined,
                        repo,
                    }));
                if (!!creds && isTokenCredentials(creds)) {
                    token = creds.token;
                    _.set(sdm.configuration, "sdm.goal.yaml.token", token);
                }
            } catch (e) {
                // Intentionally ignore that error here
            }
        }
    }

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
                headers: {
                    ...(!!token ? { Authorization: `Bearer ${token}` } : {}),
                },
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
                    await resolvePlaceholders(pdg,
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
