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
    SdmContext,
    SdmGoalEvent,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import { readSdmVersion } from "../../internal/delivery/build/local/projectVersioner";

/**
 * Simple test to see if SDM is running in Kubernetes.  It is called
 * from a non-async function, so it must be non-async.
 *
 * @return `true` if process is running in Kubernetes, `false` otherwise.
 */
export function runningInK8s(): boolean {
    const k8sFile = "/var/containerRun/secrets/kubernetes.io/serviceaccount/namespace";
    return fs.pathExistsSync(k8sFile);
}

/**
 * Return environment variables required by the container goal
 * execution machinery.
 *
 * @param goalEvent SDM goal event being executed as a container goal
 * @param ctx SDM context for goal execution
 * @return SDM goal environment variables
 */
export async function envVars(goalEvent: SdmGoalEvent, ctx: SdmContext): Promise<Array<{ name: string, value: string }>> {
    const version = await readSdmVersion(
        goalEvent.repo.owner,
        goalEvent.repo.name,
        goalEvent.repo.providerId,
        goalEvent.sha,
        goalEvent.branch,
        ctx.context,
    );
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
        name: "ATOMIST_GOAL_SET_ID",
        value: goalEvent.goalSetId,
    }, {
        name: "ATOMIST_GOAL",
        value: goalEvent.uniqueName,
    }].filter(e => !!e.value);
}
