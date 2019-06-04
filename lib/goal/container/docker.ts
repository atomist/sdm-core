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
    ImplementationRegistration,
    spawnLog,
    SpawnLogOptions,
    SpawnLogResult,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as stringify from "json-stringify-safe";
import * as _ from "lodash";
import * as os from "os";
import * as path from "path";
import {
    Container,
    ContainerProjectHome,
    ContainerRegistration,
    ContainerScheduler,
    GoalContainer,
    GoalContainerSpec,
} from "./container";
import {
    containerEnvVars,
    copyProject,
    loglog,
} from "./util";

/**
 * Additional options for Docker CLI implementation of container goals.
 */
export interface DockerContainerRegistration extends ContainerRegistration {
    /** Additional Docker CLI command-line options. */
    dockerOptions?: string[];
}

export const dockerContainerScheduler: ContainerScheduler = (goal, registration: DockerContainerRegistration) => {
    goal.addFulfillment({
        goalExecutor: executeDockerJob(goal, registration),
        name: DefaultGoalNameGenerator.generateName(`container-docker-${goal.uniqueName}`),
        ...registration as ImplementationRegistration,
    });
};

interface SpawnedContainer {
    name: string;
    promise: Promise<SpawnLogResult>;
}

/**
 * Execute container goal using Docker CLI.  Wait on completion of
 * first container, then kill all the rest.
 */
export function executeDockerJob(goal: Container, registration: DockerContainerRegistration): ExecuteGoal {
    return doWithProject(async gi => {
        const { goalEvent, progressLog, project } = gi;

        const spec: GoalContainerSpec = _.merge({}, { containers: registration.containers, volumes: registration.volumes },
            (registration.callback) ? await registration.callback(registration, project, goal, goalEvent, gi.context) : {});

        if (!spec.containers || spec.containers.length < 1) {
            throw new Error("No containers defined in GoalContainerSpec");
        }

        const goalName = goalEvent.uniqueName.split("#")[0].toLowerCase();
        const namePrefix = "sdm-";
        const nameSuffix = `-${goalEvent.goalSetId.slice(0, 7)}-${goalName}`;

        const projectDir = project.baseDir;
        const containerDir = path.join(os.homedir(), ".atomist", "tmp", project.id.owner, project.id.repo, goalEvent.goalSetId,
            `${namePrefix}tmp-${guid()}${nameSuffix}`);
        try {
            await copyProject(projectDir, containerDir);
        } catch (e) {
            const message = `Failed to duplicate project directory for goal ${goalName}: ${e.message}`;
            loglog(message, logger.error, progressLog);
            return { code: 1, message };
        }

        const spawnOpts = {
            log: progressLog,
            cwd: containerDir,
        };

        const network = `${namePrefix}network-${guid()}${nameSuffix}`;
        const networkCreateRes = await spawnLog("docker", ["network", "create", network], spawnOpts);
        if (networkCreateRes.code) {
            let message = `Failed to create Docker network '${network}'` +
                ((networkCreateRes.error) ? `: ${networkCreateRes.error.message}` : "");
            loglog(message, logger.error, progressLog);
            try {
                await dockerCleanup({ containerDir, projectDir, spawnOpts });
            } catch (e) {
                networkCreateRes.code++;
                message += `; ${e.message}`;
            }
            return { code: networkCreateRes.code, message };
        }

        const atomistEnvs = (await containerEnvVars(gi.goalEvent, gi)).map(env => `--env=${env.name}=${env.value}`);

        const spawnedContainers: SpawnedContainer[] = [];
        const failures: string[] = [];
        for (const container of spec.containers) {
            const containerName = `${namePrefix}${container.name}${nameSuffix}`;
            let containerArgs: string[];
            try {
                containerArgs = containerDockerOptions(container, registration);
            } catch (e) {
                loglog(e.message, logger.error, progressLog);
                failures.push(e.message);
                break;
            }
            const dockerArgs = [
                "run",
                "-t",
                "--rm",
                `--name=${containerName}`,
                `--volume=${containerDir}:${ContainerProjectHome}`,
                `--network=${network}`,
                `--network-alias=${container.name}`,
                ...containerArgs,
                ...(registration.dockerOptions || []),
                ...atomistEnvs,
                container.image,
                ...(container.args || []),
            ];
            if (spawnedContainers.length < 1) {
                dockerArgs.splice(5, 0, `-w=${ContainerProjectHome}`);
            }
            const promise = spawnLog("docker", dockerArgs, spawnOpts);
            spawnedContainers.push({ name: containerName, promise });
        }
        if (failures.length > 0) {
            try {
                await dockerCleanup({ containerDir, network, projectDir, spawnOpts, containers: spawnedContainers });
            } catch (e) {
                failures.push(e.message);
            }
            return {
                code: failures.length,
                message: `Failed to spawn Docker containers: ${failures.join("; ")}`,
            };
        }

        const main = spawnedContainers[0];
        try {
            const result = await main.promise;
            if (result.code) {
                const msg = `Docker container '${main.name}' failed` + ((result.error) ? `: ${result.error.message}` : "");
                loglog(msg, logger.error, progressLog);
                failures.push(msg);
            }
        } catch (e) {
            const message = `Failed to execute main Docker container '${main.name}': ${e.message}`;
            loglog(message, logger.error, progressLog);
            failures.push(message);
        }

        const sidecars = spawnedContainers.slice(1);
        try {
            await dockerCleanup({ containerDir, network, projectDir, spawnOpts, containers: sidecars });
        } catch (e) {
            failures.push(e.message);
        }

        return {
            code: failures.length,
            message: (failures.length > 0) ? failures.join("; ") : "Successfully completed container job",
        };
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
    const entryPoint: string[] = [];
    if (container.command && container.command.length > 0) {
        // Docker CLI entrypoint must be a binary...
        entryPoint.push(`--entrypoint=${container.command[0]}`);
        // ...so prepend any other command elements to args array
        if (container.args) {
            container.args.splice(0, 0, ...container.command.slice(1));
        } else {
            container.args = container.command.slice(1);
        }
    }
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

/**
 * Docker elements to cleanup after execution.
 */
interface CleanupOptions {
    /**
     * Project directory created for goal.  Its contents are replaced
     * with the contents of the [[containerDirectory]].
     */
    projectDir: string;
    /**
     * Options to use when calling spawnLog.  Also provides the
     * progress log.
     */
    spawnOpts: SpawnLogOptions;
    /**
     * Project directory mounted into container.  If it is provided,
     * its contents are copied to the [[projectDirectory]] and then
     * the directory is removed.
     */
    containerDir?: string;
    /** Containers to kill by name, if provided. */
    containers?: SpawnedContainer[];
    /**
     * Name of Docker network created for this goal execution.  If
     * provided, it will be removed.
     */
    network?: string;
}

/**
 * Kill running Docker containers, then delete network, copy
 * container's project directory to original project directory, and
 * remove directory container directory.  If the copy fails, it throws
 * an error.  Other errors are logged and ignored.
 *
 * @param opts See [[CleanupOptions]]
 */
async function dockerCleanup(opts: CleanupOptions): Promise<void> {
    if (opts.containers) {
        await dockerKill(opts.containers, opts.spawnOpts);
    }
    if (opts.network) {
        const networkDeleteRes = await spawnLog("docker", ["network", "rm", opts.network], opts.spawnOpts);
        if (networkDeleteRes.code) {
            const msg = `Failed to delete Docker network '${opts.network}'` +
                ((networkDeleteRes.error) ? `: ${networkDeleteRes.error.message}` : "");
            loglog(msg, logger.error, opts.spawnOpts.log);
        }
    }
    if (opts.containerDir) {
        try {
            await copyProject(opts.containerDir, opts.projectDir);
        } catch (e) {
            e.message = `Failed to update project directory '${opts.projectDir}' with contents from container ` +
                `directory '${opts.containerDir}': ${e.message}`;
            loglog(e.message, logger.error, opts.spawnOpts.log);
            throw e;
        }
        try {
            await fs.remove(opts.containerDir);
        } catch (e) {
            const message = `Failed to remove container directory '${opts.containerDir}': ${e.message}`;
            loglog(message, logger.error, opts.spawnOpts.log);
        }
    }
}

/**
 * Kill Docker containers.  Any errors are caught and logged, but not
 * re-thrown.
 *
 * @param containers Containers to kill, they will be killed by name
 * @param opts Options to use when calling spawnLog
 */
async function dockerKill(containers: SpawnedContainer[], opts: SpawnLogOptions): Promise<void> {
    try {
        const killPromises: Array<Promise<SpawnLogResult>> = [];
        for (const container of containers) {
            killPromises.push(spawnLog("docker", ["kill", container.name], opts));
        }
        await Promise.all(killPromises);
    } catch (e) {
        const message = `Failed to kill Docker containers: ${e.message}`;
        loglog(message, logger.error, opts.log);
    }
}
