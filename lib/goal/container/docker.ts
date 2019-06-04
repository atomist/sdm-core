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
    guid,
    logger,
} from "@atomist/automation-client";
import {
    DefaultGoalNameGenerator,
    doWithProject,
    ExecuteGoal,
    ExecuteGoalResult,
    ImplementationRegistration,
    spawnLog,
    SpawnLogResult,
} from "@atomist/sdm";
import * as stringify from "json-stringify-safe";
import * as _ from "lodash";
import {
    Container,
    ContainerRegistration,
    ContainerScheduler,
    GoalContainer,
    GoalContainerSpec,
} from "./container";
import { envVars } from "./util";

export interface DockerContainerRegistration extends ContainerRegistration {
    /** Additional Docker CLI command-line options. */
    dockerOptions?: string[];
}

export const dockerContainerScheduler: ContainerScheduler = (goal, registration: DockerContainerRegistration) => {
    goal.addFulfillment({
        goalExecutor: executeDockerJob(goal, registration),
        name: DefaultGoalNameGenerator.generateName("container-docker"),
        ...registration as ImplementationRegistration,
    });
};

export function executeDockerJob(goal: Container, registration: DockerContainerRegistration): ExecuteGoal {
    return doWithProject(async gi => {
        const { goalEvent, progressLog, project } = gi;

        const spec: GoalContainerSpec = _.merge({}, { containers: registration.containers, volumes: registration.volumes },
            (registration.callback) ? await registration.callback(registration, project, goal, goalEvent, gi.context) : {});

        const goalName = goalEvent.uniqueName.split("#")[0].toLowerCase();
        const namePrefix = "sdm-";
        const nameSuffix = `-${goalEvent.goalSetId.slice(0, 7)}-${goalName}`;
        const networkName = `${namePrefix}network-${guid()}${nameSuffix}`;
        const networkCreateRes = await spawnLog("docker", ["network", "create", networkName], { log: progressLog });
        if (networkCreateRes.code) {
            const message = `Failed to create Docker network '${networkName}'` +
                ((networkCreateRes.error) ? `: ${networkCreateRes.error.message}` : "");
            progressLog.write(message);
            logger.error(message);
            return { code: networkCreateRes.code, message };
        }

        const atomistEnvs = (await envVars(gi.goalEvent, gi)).map(env => `--env=${env.name}=${env.value}`);
        const spawnOpts = {
            log: progressLog,
            cwd: project.baseDir,
        };

        const spawnedContainers: Array<{ name: string, promise: Promise<SpawnLogResult> }> = [];
        const result: ExecuteGoalResult = { code: 0 };
        const failures: string[] = [];
        for (const container of spec.containers) {
            const containerName = `${namePrefix}${container.name}${nameSuffix}`;
            let containerArgs: string[];
            try {
                containerArgs = containerDockerOptions(container, registration);
            } catch (e) {
                progressLog.write(e.message);
                failures.push(e.message);
                break;
            }
            const dockerArgs = [
                "run",
                "-t",
                "--rm",
                `--name=${containerName}`,
                `--volume=${project.baseDir}:/atm/home`,
                `--network=${networkName}`,
                `--network-alias=${container.name}`,
                ...containerArgs,
                ...(registration.dockerOptions || []),
                ...atomistEnvs,
                container.image,
                ...(container.args || []),
            ];
            const promise = spawnLog("docker", dockerArgs, spawnOpts);
            spawnedContainers.push({ name: containerName, promise });
        }

        const results: Array<{ name: string, result: SpawnLogResult }> = [];
        for (const res of spawnedContainers) {
            try {
                const containerResult = await res.promise;
                results.push({ name: res.name, result: containerResult });
            } catch (e) {
                e.message = `Failed to execute Docker container '${res.name}': ${e.message}`;
                progressLog.write(e.message);
                logger.error(e.message);
                failures.push(e.message);
            }
        }
        for (const res of results) {
            if (res.result.code) {
                const msg = `Docker container '${res.name}' failed` + ((res.result.error) ? `: ${res.result.error.message}` : "");
                progressLog.write(msg);
                logger.error(msg);
                failures.push(msg);
            }
        }

        if (failures.length > 0) {
            result.code = failures.length;
            result.message = failures.join("; ");
        } else {
            result.message = "Successfully completed container job";
        }

        const networkDeleteRes = await spawnLog("docker", ["network", "rm", networkName], { log: progressLog });
        if (networkDeleteRes.code) {
            const msg = `Failed to delete Docker network '${networkName}` +
                ((networkDeleteRes.error) ? `: ${networkDeleteRes.error.message}` : "");
            progressLog.write(msg);
            logger.error(msg);
            result.message += `; ${msg}`;
        }

        return result;
    }, { readOnly: false });
}

/**
 * Generate container specific Docker command-line options.
 *
 * @param container Goal container spec
 * @param registration Container goal registration object
 * @return Docker command-line entrypoint, env, p, and volume options
 */
export function containerDockerOptions(container: GoalContainer, registration: ContainerRegistration): string[] {
    const entryPoint = (container.command && container.command.length > 0) ? [`--entrypoint=${container.command.join(" ")}`] : [];
    const envs = (container.env || []).map(env => `--env=${env.name}=${env.value}`);
    const ports = (container.ports || []).map(port => `-p=${port.containerPort}`);
    const volumes: string[] = [];
    for (const vm of (container.volumeMounts || [])) {
        const volume = (registration.volumes || []).find(v => v.name === vm.name);
        if (!volume) {
            const msg = `Container '${container.name}' references volume '${vm.name}' which not provided in goal registration ` +
                `volumes: ${stringify(registration.volumes)}`;
            logger.error(msg);
            throw new Error(msg);
        }
        volumes.push(`--volume=${volume.hostPath.path}:${vm.mountPath}`);
    }
    return [
        ...entryPoint,
        ...envs,
        ...ports,
        ...volumes,
    ];
}
