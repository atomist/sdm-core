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
    GitCommandGitProject,
    GitProject,
    guid,
    logger,
} from "@atomist/automation-client";
import { sleep } from "@atomist/automation-client/lib/internal/util/poll";
import {
    doWithProject,
    ExecuteGoal,
    GoalScheduler,
    ImplementationRegistration,
    ProgressLog,
    RepoContext,
    SdmGoalEvent,
    SdmGoalState,
    ServiceRegistrationGoalDataKey,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";
import * as fs from "fs-extra";
import * as stringify from "json-stringify-safe";
import * as _ from "lodash";
import * as os from "os";
import * as path from "path";
import * as request from "request";
import { Writable } from "stream";
import {
    DeepPartial,
    Merge,
} from "ts-essentials";
import { loadKubeConfig } from "../../pack/k8s/config";
import {
    k8sJobEnv,
    KubernetesGoalScheduler,
    readNamespace,
} from "../../pack/k8s/KubernetesGoalScheduler";
import {
    K8sServiceRegistrationType,
    K8sServiceSpec,
} from "../../pack/k8s/service";
import { toArray } from "../../util/misc/array";
import {
    Container,
    ContainerInput,
    ContainerOutput,
    ContainerProjectHome,
    ContainerRegistration,
    ContainerScheduler,
    GoalContainer,
    GoalContainerVolume,
} from "./container";
import { prepareSecrets } from "./provider";
import {
    containerEnvVars,
    copyProject,
    loglog,
    prepareInputAndOutput,
    processResult,
} from "./util";

// tslint:disable:max-file-line-count

/**
 * Specification of containers and volumes for a container goal.
 */
export interface K8sGoalContainerSpec {
    /**
     * Containers to run for this goal.  The goal result is based on
     * the exit status of the first element of the `containers` array.
     * The other containers are considered "sidecar" containers
     * provided functionality that the main container needs to
     * function.  If not set, the working directory of the first
     * container is set to [[ContainerProjectHome]], which contains
     * the project upon which the goal should operate.  If
     * `workingDir` is set, it is not changed.  If `workingDir` is set
     * to the empty string, the `workingDir` property is deleted from
     * the main container spec, meaning the container default working
     * directory will be used.
     */
    containers: Array<Merge<DeepPartial<k8s.V1Container>, GoalContainer>>;
    /**
     * Volumes available to mount in containers.
     */
    volumes?: Array<Merge<DeepPartial<k8s.V1Volume>, GoalContainerVolume>>;
}

/**
 * Function signature for callback that can modify and return the
 * [[ContainerRegistration]] object.
 */
export type K8sContainerSpecCallback =
    (r: K8sContainerRegistration, p: GitProject, g: Container, e: SdmGoalEvent, ctx: RepoContext) => Promise<K8sGoalContainerSpec>;

/**
 * Additional options for Kubernetes implementation of container goals.
 */
export interface K8sContainerRegistration extends ContainerRegistration {
    /**
     * Replace generic containers in [[ContainerRegistration]] with
     * Kubernetes containers.
     */
    containers: Array<Merge<DeepPartial<k8s.V1Container>, GoalContainer>>;
    /**
     * Replace generic callback in [[ContainerRegistration]] with
     * Kubernetes-specific callback.
     */
    callback?: K8sContainerSpecCallback;
    /**
     * Replace generic volumes in [[ContainerRegistration]] with
     * Kubernetes volumes.
     */
    volumes?: Array<Merge<DeepPartial<k8s.V1Volume>, GoalContainerVolume>>;
}

export const k8sContainerScheduler: ContainerScheduler = (goal, registration: K8sContainerRegistration) => {
    goal.addFulfillment({
        goalExecutor: executeK8sJob(goal, registration),
        ...registration as ImplementationRegistration,
    });

    goal.addFulfillmentCallback({
        goal,
        callback: k8sFulfillmentCallback(goal, registration),
    });
};

/**
 * Add Kubernetes job scheduling information to SDM goal event data
 * for use by the [[KubernetesGoalScheduler]].
 */
export function k8sFulfillmentCallback(
    goal: Container,
    registration: K8sContainerRegistration,
): (sge: SdmGoalEvent, rc: RepoContext) => Promise<SdmGoalEvent> {

    return async (goalEvent, repoContext) => {
        const spec: K8sGoalContainerSpec = _.merge({}, {
            containers: registration.containers,
            volumes: registration.volumes,
        });
        if (registration.callback) {
            const project = await GitCommandGitProject.cloned(repoContext.credentials, repoContext.id);
            _.merge(spec, await registration.callback(registration, project, goal, goalEvent, repoContext));
        }

        if (!spec.containers || spec.containers.length < 1) {
            throw new Error("No containers defined in K8sGoalContainerSpec");
        }

        if (spec.containers[0].workingDir === "") {
            delete spec.containers[0].workingDir;
        } else if (!spec.containers[0].workingDir) {
            spec.containers[0].workingDir = ContainerProjectHome;
        }
        const containerEnvs = await containerEnvVars(goalEvent, repoContext);
        spec.containers.forEach(c => {
            c.env = [
                ...containerEnvs,
                ...(c.env || []),
            ];
        });

        const goalSchedulers: GoalScheduler[] = toArray(repoContext.configuration.sdm.goalScheduler) || [];
        const k8sScheduler = goalSchedulers.find(gs => gs instanceof KubernetesGoalScheduler) as KubernetesGoalScheduler;
        if (!k8sScheduler) {
            throw new Error("Failed to find KubernetesGoalScheduler in goal schedulers");
        }
        if (!k8sScheduler.podSpec) {
            throw new Error("KubernetesGoalScheduler has no podSpec defined");
        }

        const initContainer = _.cloneDeep(k8sScheduler.podSpec.spec.containers[0]);
        delete initContainer.lifecycle;
        delete initContainer.livenessProbe;
        delete initContainer.readinessProbe;
        initContainer.name = `container-goal-init-${guid().split("-")[0]}`;
        initContainer.env = [
            ...(initContainer.env || []),
            ...k8sJobEnv(k8sScheduler.podSpec, goalEvent, repoContext.context as any),
            {
                name: "ATOMIST_PROJECT_DIR",
                value: ContainerProjectHome,
            },
            {
                name: "ATOMIST_INPUT_DIR",
                value: ContainerInput,
            },
            {
                name: "ATOMIST_OUTPUT_DIR",
                value: ContainerOutput,
            },
            {
                name: "ATOMIST_ISOLATED_GOAL_INIT",
                value: "true",
            },
        ];
        const projectVolume = `project-${guid().split("-")[0]}`;
        const inputVolume = `input-${guid().split("-")[0]}`;
        const outputVolume = `output-${guid().split("-")[0]}`;
        initContainer.volumeMounts = [
            ...(initContainer.volumeMounts || []),
            {
                mountPath: ContainerProjectHome,
                name: projectVolume,
            },
            {
                mountPath: ContainerInput,
                name: inputVolume,
            },
            {
                mountPath: ContainerOutput,
                name: outputVolume,
            },
        ];

        const secrets = await prepareSecrets(registration.containers[0], repoContext);
        spec.containers.forEach(c => {
            c.env = [
                ...(secrets.env || []),
                ...(c.env || []),
            ];
        });
        const secretVolumes = [];
        if (!!secrets?.files) {
            for (const file of secrets.files) {
                const fileName = path.basename(file.mountPath);
                const dirname = path.dirname(file.mountPath);
                let secretName = `secret-${guid().split("-")[0]}`;

                const vm = (initContainer.volumeMounts || [])
                    .find(m => m.mountPath === dirname);
                if (!!vm) {
                   secretName = vm.name;
                } else {
                    initContainer.volumeMounts = [
                        ...(initContainer.volumeMounts || []),
                        {
                            mountPath: dirname,
                            name: secretName,
                        },
                    ];
                    spec.volumes = [
                        ...(spec.volumes || []),
                        {
                            name: secretName,
                            emptyDir: {},
                        } as any,
                    ];
                }
                spec.containers.forEach((c: k8s.V1Container) => {
                    c.volumeMounts = [
                        ...(c.volumeMounts || []),
                        {
                            mountPath: file.mountPath,
                            name: secretName,
                            subPath: fileName,
                        },
                    ];
                });
            }
        }

        const serviceSpec: { type: string, spec: K8sServiceSpec } = {
            type: K8sServiceRegistrationType.K8sService,
            spec: {
                container: spec.containers,
                initContainer: [initContainer],
                volume: [
                    {
                        name: projectVolume,
                        emptyDir: {},
                    },
                    {
                        name: inputVolume,
                        emptyDir: {},
                    },
                    {
                        name: outputVolume,
                        emptyDir: {},
                    },
                    ...(spec.volumes || []),
                    ...(secretVolumes.map(s => ({
                        name: s,
                        secret: {
                            secretName: s,
                        },
                    }))),
                ],
                volumeMount: [
                    {
                        mountPath: ContainerProjectHome,
                        name: projectVolume,
                    },
                    {
                        mountPath: ContainerInput,
                        name: inputVolume,
                    },
                    {
                        mountPath: ContainerOutput,
                        name: outputVolume,
                    },
                ],
            },
        };

        const data: any = JSON.parse(goalEvent.data || "{}");
        const servicesData: any = {};
        _.set<any>(servicesData, `${ServiceRegistrationGoalDataKey}.${registration.name}`, serviceSpec);
        goalEvent.data = JSON.stringify(_.merge(data, servicesData));
        return goalEvent;
    };
}

/** Container information useful the various functions. */
interface K8sContainer {
    /** Kubernetes configuration to use when creating API clients */
    config: k8s.KubeConfig;
    /** Name of container in pod */
    name: string;
    /** Pod name */
    pod: string;
    /** Pod namespace */
    ns: string;
    /** Log */
    log: ProgressLog;
}

/**
 * Wait for first container to exit and stream its logs to the
 * progress log.
 */
// tslint:disable-next-line:cyclomatic-complexity
export function executeK8sJob(goal: Container, registration: K8sContainerRegistration): ExecuteGoal {
    return doWithProject(async gi => {
        const { goalEvent, progressLog, project } = gi;

        const projectDir = process.env.ATOMIST_PROJECT_DIR || ContainerProjectHome;
        const inputDir = process.env.ATOMIST_INPUT_DIR || ContainerInput;
        const outputDir = process.env.ATOMIST_OUTPUT_DIR || ContainerOutput;

        if (process.env.ATOMIST_ISOLATED_GOAL_INIT === "true") {
            try {
                await copyProject(project.baseDir, projectDir);
            } catch (e) {
                const message = `Failed to copy project for goal execution: ${e.message}`;
                loglog(message, logger.error, progressLog);
                return { code: 1, message };
            }
            try {
                await prepareInputAndOutput(inputDir, outputDir, gi);
            } catch (e) {
                const message = `Failed to prepare input and output for goal ${goalEvent.name}: ${e.message}`;
                loglog(message, logger.error, progressLog);
                return { code: 1, message };
            }
            const secrets = await prepareSecrets(registration.containers[0], gi);
            if (!!secrets?.files) {
                for (const file of secrets.files) {
                    await fs.writeFile(file.mountPath, file.value);
                }
            }
            goalEvent.state = SdmGoalState.in_process;
            return goalEvent;
        }

        const spec: K8sGoalContainerSpec = _.merge({}, {
                containers: registration.containers,
                volumes: registration.volumes,
            },
            (registration.callback) ? await registration.callback(registration, project, goal, goalEvent, gi) : {});
        let containerName: string = _.get(spec, "containers[0].name");
        if (!containerName) {
            const msg = `Failed to get main container name from goal registration: ${stringify(spec)}`;
            loglog(msg, logger.warn, progressLog);
            let svcSpec: K8sServiceSpec;
            try {
                const data = JSON.parse(goalEvent.data || "{}");
                svcSpec = _.get(data, `${ServiceRegistrationGoalDataKey}.${registration.name}.spec`);
            } catch (e) {
                const message = `Failed to parse Kubernetes spec from goal data '${goalEvent.data}': ${e.message}`;
                loglog(message, logger.error, progressLog);
                return { code: 1, message };
            }
            containerName = _.get(svcSpec, "container[1].name");
            if (!containerName) {
                const message = `Failed to get main container name from either goal registration or data: '${goalEvent.data}'`;
                loglog(message, logger.error, progressLog);
                return { code: 1, message };
            }
        }
        const ns = await readNamespace();
        const podName = os.hostname();

        let kc: k8s.KubeConfig;
        try {
            kc = loadKubeConfig();
        } catch (e) {
            const message = `Failed to load Kubernetes configuration: ${e.message}`;
            loglog(message, logger.error, progressLog);
            return { code: 1, message };
        }

        const container: K8sContainer = {
            config: kc,
            name: containerName,
            pod: podName,
            ns,
            log: progressLog,
        };

        try {
            await containerStarted(container);
        } catch (e) {
            loglog(e.message, logger.error, progressLog);
            return { code: 1, message: e.message };
        }

        const log = followK8sLog(container);

        const status = { code: 0, message: `Container '${containerName}' completed successfully` };
        try {
            const podStatus = await containerWatch(container);
            loglog(`Container '${containerName}' exited: ${stringify(podStatus)}`, logger.debug, progressLog);
        } catch (e) {
            const message = `Container '${containerName}' failed: ${e.message}`;
            loglog(message, logger.error, progressLog);
            status.code++;
            status.message = message;
        } finally {
            // Give the logs some time to be delivered
            await sleep(1000);
            log.abort();
        }

        try {
            await copyProject(projectDir, project.baseDir);
        } catch (e) {
            const message = `Failed to update project after goal execution: ${e.message}`;
            loglog(message, logger.error, progressLog);
            status.code++;
            status.message += ` but f${message.slice(1)}`;
        }

        const outputFile = path.join(outputDir, "result.json");
        let outputResult;
        if ((await fs.pathExists(outputFile)) && status.code === 0) {
            try {
                outputResult = await processResult(await fs.readJson(outputFile), gi);
            } catch (e) {
                const message = `Failed to read output from Docker container: ${e.message}`;
                loglog(message, logger.error, progressLog);
                status.code++;
                status.message += ` but f${message.slice(1)}`;
            }
        }

        return outputResult || status;
    }, { readOnly: false });
}

/**
 * Wait for container in pod to start, return when it does.
 *
 * @param container Information about container to check
 * @param attempts Maximum number of attempts, waiting 500 ms between
 */
async function containerStarted(container: K8sContainer, attempts: number = 120): Promise<void> {
    let core: k8s.CoreV1Api;
    try {
        core = container.config.makeApiClient(k8s.CoreV1Api);
    } catch (e) {
        e.message = `Failed to create Kubernetes core API client: ${e.message}`;
        loglog(e.message, logger.error, container.log);
        throw e;
    }

    const sleepTime = 500; // ms
    for (let i = 0; i < attempts; i++) {
        await sleep(500);
        const pod = (await core.readNamespacedPod(container.pod, container.ns)).body;
        const containerStatus = pod.status.containerStatuses.find(c => c.name === container.name);
        if (containerStatus && (!!_.get(containerStatus, "state.running.startedAt") || !!_.get(containerStatus, "state.terminated"))) {
            const message = `Container '${container.name}' started`;
            container.log.write(message);
            return;
        }
    }

    const errMsg = `Container '${container.name}' failed to start within ${attempts * sleepTime} ms`;
    loglog(errMsg, logger.error, container.log);
    throw new Error(errMsg);
}

/**
 * Watch pod until container `container.name` exits.  Resolve promise
 * with status if container `container.name` exits with status 0.
 * Reject promise otherwise, including pod status in the `podStatus`
 * property of the error.
 *
 * @param container Information about container to watch
 * @return Status of pod after container terminates
 */
function containerWatch(container: K8sContainer): Promise<k8s.V1PodStatus> {
    return new Promise((resolve, reject) => {
        let watch: k8s.Watch;
        try {
            watch = new k8s.Watch(container.config);
        } catch (e) {
            e.message = `Failed to create Kubernetes watch client: ${e.message}`;
            loglog(e.message, logger.error, container.log);
            reject(e);
        }
        const watchPath = `/api/v1/watch/namespaces/${container.ns}/pods/${container.pod}`;
        let watcher: any;
        watcher = watch.watch(watchPath, {}, (phase, obj) => {
            const pod = obj as k8s.V1Pod;
            if (pod && pod.status && pod.status.containerStatuses) {
                const containerStatus = pod.status.containerStatuses.find(c => c.name === container.name);
                if (containerStatus && containerStatus.state && containerStatus.state.terminated) {
                    const exitCode: number = _.get(containerStatus, "state.terminated.exitCode");
                    if (exitCode === 0) {
                        const msg = `Container '${container.name}' exited with status 0`;
                        container.log.write(msg);
                        resolve(pod.status);
                    } else {
                        const msg = `Container '${container.name}' exited with status ${exitCode}`;
                        loglog(msg, logger.error, container.log);
                        const err = new Error(msg);
                        (err as any).podStatus = pod.status;
                        reject(err);
                    }
                    if (watcher) {
                        watcher.abort();
                    }
                    return;
                }
            }
            container.log.write(`Container '${container.name}' still running`);
        }, err => {
            err.message = `Container watcher failed: ${err.message}`;
            loglog(err.message, logger.error, container.log);
            reject(err);
        });
    });
}

/**
 * Set up log follower for container.
 */
function followK8sLog(container: K8sContainer): request.Request {
    const k8sLog = new k8s.Log(container.config);
    const logStream = new Writable({
        write: (chunk, encoding, callback) => {
            container.log.write(chunk.toString());
            callback();
        },
    });
    const doneCallback = e => {
        if (e) {
            if (e.message) {
                loglog(e.message, logger.error, container.log);
            } else {
                loglog(stringify(e), logger.error, container.log);
            }
        }
    };
    const logOptions: k8s.LogOptions = { follow: true };
    return k8sLog.log(container.ns, container.pod, container.name, logStream, doneCallback, logOptions);
}
