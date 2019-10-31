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

import { LeveledLogMethod } from "@atomist/automation-client";
import {
    GoalInvocation,
    ProgressLog,
    SdmContext,
    SdmGoalEvent,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as path from "path";
import { getGoalVersion } from "../../internal/delivery/build/local/projectVersioner";
import { K8sNamespaceFile } from "../../pack/k8s/KubernetesGoalScheduler";
import {
    ContainerInput,
    ContainerOutput,
    ContainerResult,
} from "./container";

/**
 * Simple test to see if SDM is running in Kubernetes.  It is called
 * from a non-async function, so it must be non-async.
 *
 * @return `true` if process is running in Kubernetes, `false` otherwise.
 */
export function runningInK8s(): boolean {
    return fs.pathExistsSync(K8sNamespaceFile);
}

/**
 * Return environment variables required by the container goal
 * execution machinery.
 *
 * @param goalEvent SDM goal event being executed as a container goal
 * @param ctx SDM context for goal execution
 * @return SDM goal environment variables
 */
export async function containerEnvVars(goalEvent: SdmGoalEvent, ctx: SdmContext): Promise<Array<{ name: string, value: string }>> {
    const version = await getGoalVersion({
        owner: goalEvent.repo.owner,
        repo: goalEvent.repo.name,
        providerId: goalEvent.repo.providerId,
        sha: goalEvent.sha,
        branch: goalEvent.branch,
        context: ctx.context,
    });
    return [{
        name: "ATOMIST_SLUG",
        value: `${goalEvent.repo.owner}/${goalEvent.repo.name}`,
    }, {
        name: "ATOMIST_OWNER",
        value: goalEvent.repo.owner,
    }, {
        name: "ATOMIST_REPO",
        value: goalEvent.repo.name,
    }, {
        name: "ATOMIST_SHA",
        value: goalEvent.sha,
    }, {
        name: "ATOMIST_BRANCH",
        value: goalEvent.branch,
    }, {
        name: "ATOMIST_VERSION",
        value: version,
    }, {
        name: "ATOMIST_GOAL",
        value: `${ContainerInput}/goal.json`,
    }, {
        name: "ATOMIST_SECRETS",
        value: `${ContainerInput}/secrets.json`,
    }, {
        name: "ATOMIST_RESULT",
        value: ContainerResult,
    }, {
        name: "ATOMIST_INPUT",
        value: ContainerInput,
    }, {
        name: "ATOMIST_OUTPUT",
        value: ContainerOutput,
    }].filter(e => !!e.value);
}

/**
 * Copy cloned project to location that can be mounted into container.
 * It ensures the destination direction exists and is empty.  If it
 * fails it throws an error and tries to ensure the destination
 * directory does not exist.
 *
 * @param src Location of project directory
 * @param dest Location to copy project to
 */
export async function copyProject(src: string, dest: string): Promise<void> {
    try {
        await fs.emptyDir(dest);
    } catch (e) {
        e.message = `Failed to empty directory '${dest}'`;
        throw e;
    }
    try {
        await fs.copy(src, dest);
    } catch (e) {
        e.message = `Failed to copy project from '${src}' to '${dest}'`;
        try {
            await fs.remove(dest);
        } catch (err) {
            e.message += `; Failed to clean up '${dest}': ${err.message}`;
        }
        throw e;
    }
}

export async function prepareInputAndOutput(input: string, output: string, gi: GoalInvocation): Promise<void> {
    try {
        await fs.emptyDir(input);
    } catch (e) {
        e.message = `Failed to empty directory '${input}'`;
        throw e;
    }
    try {
        await fs.writeJson(path.join(input, "goal.json"), gi.goalEvent, { spaces: 2});
        await fs.writeJson(path.join(input, "secrets.json"), {
            apiKey: gi.configuration.apiKey,
            credentials: gi.credentials,
        }, { spaces: 2});
    } catch (e) {
        e.message = `Failed to write metadata to '${input}'`;
        try {
            await fs.remove(input);
        } catch (err) {
            e.message += `; Failed to clean up '${input}': ${err.message}`;
        }
        throw e;
    }
    try {
        await fs.emptyDir(output);
    } catch (e) {
        e.message = `Failed to empty directory '${output}'`;
        throw e;
    }
}

/**
 * Write to client and progress logs.  Add newline to progress log.
 *
 * @param msg Message to write, should not have newline at end
 * @param l Logger method, e.g., `logger.warn`
 * @param p Progress log
 */
export function loglog(msg: string, l: LeveledLogMethod, p: ProgressLog): void {
    l(msg);
    p.write(msg + "\n");
}
