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

import { GitProject } from "@atomist/automation-client";
import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import {
    allSatisfied,
    Goal,
    ImmaterialGoals,
    Locking,
    PushTest,
    RepoContext,
    SdmGoalEvent,
    SoftwareDeliveryMachine,
    StatefulPushListenerInvocation,
} from "@atomist/sdm";
import * as changeCase from "change-case";
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
                });
        } else if (goals.script) {
            const script = goals.script;
            goal = container(
                script.name,
                {
                    callback: containerCallback(),
                    name: script.name.replace(/ /g, ""),
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
            goal = additionalGoals[goals];
        } else {
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

    throw new Error(`Unable to construct goal from '${JSON.stringify(goals)}'`);
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

async function resolvePlaceholderContainerSpecCallback(r: ContainerRegistration,
                                                       p: GitProject,
                                                       g: Container,
                                                       e: SdmGoalEvent,
                                                       ctx: RepoContext): Promise<GoalContainerSpec> {
    await resolvePlaceholders(r as any, value => resolvePlaceholder(value, e, ctx));
    return r;
}

const PlaceholderExpression = /\$\{([.a-zA-Z_-]+)([.:0-9a-zA-Z-_ \" ]+)*\}/g;

export async function resolvePlaceholder(value: string,
                                         goal: SdmGoalEvent,
                                         ctx: Pick<RepoContext, "configuration" | "context">,
                                         throwErrorOnMissing: boolean = true): Promise<string> {
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
            _.get(ctx.configuration, camelCase(result[1]));
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
        } else if (typeof envValue === "object" && value === fm) {
            return envValue;
        } else if (defaultValue) {
            currentValue = currentValue.split(fm).join(defaultValue);
        } else if (throwErrorOnMissing) {
            throw new Error(`Placeholder '${result[1]}' can't be resolved`);
        } else {
            continue;
        }
        PlaceholderExpression.lastIndex = 0;
    }
    return currentValue;
}

function camelCase(key: string): string {
    return key.split(".").map(k => changeCase.camel(k)).join(".");
}
