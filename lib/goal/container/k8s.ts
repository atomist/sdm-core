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
    HandlerContext,
    logger,
} from "@atomist/automation-client";
import { sleep } from "@atomist/automation-client/lib/internal/util/poll";
import {
    DefaultGoalNameGenerator,
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
import { LineStream } from "byline";
import * as stringify from "json-stringify-safe";
import * as _ from "lodash";
import * as os from "os";
import * as request from "request";
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
    ContainerProjectHome,
    ContainerRegistration,
    ContainerScheduler,
    GoalContainer,
    GoalContainerVolume,
} from "./container";
import {
    containerEnvVars,
    copyProject,
} from "./util";

/**
 * Specification of containers and volumes for a container goal.
 */
export interface K8sGoalContainerSpec {
    /**
     * Containers to run for this goal.  The goal result is based on
     * the exit status of the first element of the `containers` array.
     * The other containers are considered "sidecar" containers
     * provided functionality that the main container needs to
     * function.  The working directory of the first container is set
     * to [[ContainerProjectHome]], which contains the project upon
     * which the goal should operate.
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
    (r: K8sContainerRegistration, p: GitProject, g: Container, e: SdmGoalEvent, c: HandlerContext) => Promise<K8sGoalContainerSpec>;

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
        name: DefaultGoalNameGenerator.generateName("container-k8s"),
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
        const spec: K8sGoalContainerSpec = _.merge({}, { containers: registration.containers, volumes: registration.volumes });
        if (registration.callback) {
            const project = await GitCommandGitProject.cloned(repoContext.credentials, repoContext.id);
            _.merge(spec, await registration.callback(registration, project, goal, goalEvent, repoContext.context));
        }

        if (!spec.containers || spec.containers.length < 1) {
            throw new Error("No containers defined in K8sGoalContainerSpec");
        }

        spec.containers[0].workingDir = ContainerProjectHome;
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
        const image: string = _.get(k8sScheduler.podSpec, "spec.containers[0].image");
        const jobEnvs = k8sJobEnv(k8sScheduler.podSpec, goalEvent, repoContext.context as any);

        const serviceSpec: { type: string, spec: K8sServiceSpec } = {
            type: K8sServiceRegistrationType.K8sService,
            spec: {
                container: spec.containers,
                initContainer: {
                    env: [
                        ...jobEnvs,
                        {
                            name: "ATOMIST_ISOLATED_GOAL_INIT",
                            value: "true",
                        },
                    ],
                    image,
                    name: "atm-init",
                    volumeMounts: [
                        {
                            mountPath: ContainerProjectHome,
                            name: "home",
                        },
                    ],
                    workingDir: ContainerProjectHome,
                },
                volume: [
                    {
                        name: "home",
                        emptyDir: {},
                    },
                ],
                volumeMount: [
                    {
                        mountPath: ContainerProjectHome,
                        name: "home",
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

/**
 * Wait for first container to exit and stream its logs to the
 * progress log.
 */
export function executeK8sJob(goal: Container, registration: K8sContainerRegistration): ExecuteGoal {
    return doWithProject(async gi => {
        const { context, goalEvent, progressLog, project } = gi;

        if (process.env.ATOMIST_ISOLATED_GOAL_INIT === "true") {
            try {
                await copyProject(project.baseDir, process.cwd());
            } catch (e) {
                const message = `Failed to copy project for goal execution: ${e.message}`;
                logger.error(message);
                progressLog.write(message);
                return { code: 1, message };
            }
            goalEvent.state = SdmGoalState.in_process;
            return goalEvent;
        }

        const spec: K8sGoalContainerSpec = _.merge({}, { containers: registration.containers, volumes: registration.volumes },
            (registration.callback) ? await registration.callback(registration, project, goal, goalEvent, context) : {});
        let containerName: string = _.get(spec, "containers[0].name");
        if (!containerName) {
            const msg = `Failed to get main container name from goal registration: ${stringify(spec)}`;
            logger.warn(msg);
            progressLog.write(msg);
            let svcSpec: K8sServiceSpec;
            try {
                const data = JSON.parse(goalEvent.data || "{}");
                svcSpec = _.get(data, `${ServiceRegistrationGoalDataKey}.${registration.name}.spec`);
            } catch (e) {
                const message = `Failed to parse Kubernetes spec from goal data '${goalEvent.data}': ${e.message}`;
                logger.error(message);
                progressLog.write(message);
                return { code: 1, message };
            }
            containerName = _.get(svcSpec, "container[1].name");
            if (!containerName) {
                const message = `Failed to get main container name from either goal registration or data: '${goalEvent.data}'`;
                logger.error(message);
                progressLog.write(message);
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
            logger.error(message);
            progressLog.write(message);
            return { code: 1, message };
        }

        const status = { code: 0, message: `Container '${containerName}' completed successfully` };
        let log: request.Request;
        try {
            let podStatus: k8s.V1PodStatus;
            [podStatus, log] = await Promise.all([
                podWatch(kc, containerName, podName, ns),
                podLog(containerName, podName, ns, progressLog),
            ]);
            logger.debug(`Container '${containerName}' exited: ${stringify(podStatus)}`);
        } catch (e) {
            const message = `Container '${containerName}' failed: ${e.message}`;
            logger.error(message);
            progressLog.write(message);
            status.code++;
            status.message = message;
        } finally {
            if (log) {
                log.abort();
            }
        }

        try {
            await copyProject(process.cwd(), project.baseDir);
        } catch (e) {
            const message = `Failed to update project after goal execution: ${e.message}`;
            logger.error(message);
            progressLog.write(message);
            status.code++;
            status.message += ` but f${message.slice(1)}`;
        }
        return status;
    }, { readOnly: false });
}

/**
 * Watch pod until container `containerName` exits.  Resolve promise
 * with status if container `containerName` exits with status 0.
 * Reject promise otherwise, including pod status in the `podStatus`
 * property of the error.
 *
 * @param containerName Name of container to wait on
 * @param podName Name of pod to watch
 * @param ns Namespace of pod to watch
 */
function podWatch(kc: k8s.KubeConfig, containerName: string, podName: string, ns: string): Promise<k8s.V1PodStatus> {
    return new Promise((resolve, reject) => {
        let watch: k8s.Watch;
        try {
            watch = new k8s.Watch(kc);
        } catch (e) {
            e.message = `Failed to create Kubernetes watch client: ${e.message}`;
            logger.error(e.message);
            reject(e);
        }
        let watcher: any;
        watcher = watch.watch(`/api/v1/watch/namespaces/${ns}/pods/${podName}`, {}, (phase, obj) => {
            const pod = obj as k8s.V1Pod;
            if (pod && pod.status && pod.status.containerStatuses) {
                const container = pod.status.containerStatuses.find(c => c.name === containerName);
                if (container && container.state && container.state.terminated) {
                    const exitCode: number = _.get(container, "state.terminated.exitCode");
                    if (exitCode === 0) {
                        logger.info(`Container '${containerName}' exited with status 0`);
                        resolve(pod.status);
                    } else {
                        const message = `Container '${containerName}' exited with status ${exitCode}`;
                        logger.error(message);
                        const err = new Error(message);
                        (err as any).podStatus = pod.status;
                        reject(err);
                    }
                    if (watcher) {
                        watcher.abort();
                    }
                    return;
                }
            }
            logger.debug(`Container '${containerName}' still running`);
        }, err => {
            logger.error(err);
            reject(err);
        });
    });
}

/**
 * Wait for container to start and the stream logs
 */
export async function podLog(containerName: string, podName: string, ns: string, progressLog: ProgressLog): Promise<request.Request> {
    let kc: k8s.KubeConfig;
    let core: k8s.Core_v1Api;
    try {
        kc = loadKubeConfig();
        core = kc.makeApiClient(k8s.Core_v1Api);
    } catch (e) {
        e.message = `Failed to create Kubernetes core API client: ${e.message}`;
        return Promise.reject(e);
    }

    let pod: k8s.V1Pod;
    let started: boolean;
    do {
        await sleep(500);
        pod = (await core.readNamespacedPod(podName, ns)).body;
        const container = pod.status.containerStatuses.find(c => c.name === containerName);
        started = !!_.get(container, "state.running.startedAt") || !!_.get(container, "state.terminated");
    } while (!started);

    return followPodLog(kc, podName, ns,
        l => { progressLog.write(l); },
        err => { if (err) { logger.error(err.message); } },
        { container: containerName },
    );
}

interface FollowLogOptions {
    /**
     * The container name for which to stream logs. Defaults to only
     * container if there is one containerRun in the pod.
     */
    container?: string;

    /**
     * If set, the number of bytes to read from the server before
     * terminating the log output. This may not display a complete
     * final line of logging, and may return slightly more or slightly
     * less than the specified limit.
     */
    limitBytes?: number;

    /**
     * If true, then the output is pretty printed.
     */
    pretty?: string;

    /**
     * Return previous terminated containerRun logs. Defaults to
     * false.
     */
    previous?: boolean;

    /**
     * A relative time in seconds before the current time from which
     * to show logs. If this value precedes the time a pod was
     * started, only logs since the pod start will be returned. If
     * this value is in the future, no logs will be returned. Only one
     * of sinceSeconds or sinceTime may be specified.
     */
    sinceSeconds?: number;

    /**
     * If set, the number of lines from the end of the logs to
     * show. If not specified, logs are shown from the creation of the
     * containerRun or sinceSeconds or sinceTime
     */
    tailLines?: number;

    /**
     * If true, add an RFC3339 or RFC3339Nano timestamp at the
     * beginning of every line of log output. Defaults to false.
     */
    timestamps?: boolean;
}

/**
 * Read log of the specified Pod.
 * @param config Kubernetes configuration for cluster
 * @param name Name of the Pod
 * @param namespace Object name and auth scope, such as for teams and projects
 * @param callback Function to execute when log data are received
 * @param done Function to call when the log stream has ended
 * @param options Options to configure how log is displayed.
 * @param return
 */
export function followPodLog(
    config: k8s.KubeConfig,
    name: string,
    namespace: string,
    callback: (line: string) => void,
    done: (err?: any) => void,
    options: FollowLogOptions = {},
): request.Request {

    if (!name) {
        throw new Error("Required parameter 'name' was null or undefined when calling followPodLog");
    }
    if (!namespace) {
        throw new Error("Required parameter 'namespace' was null or undefined when calling followPodLog.");
    }

    // Build URI
    const cluster = config.getCurrentCluster();
    if (!cluster) {
        throw new Error("No currently active cluster");
    }
    const uri = cluster.server + `/api/v1/namespaces/${namespace}/pods/${name}/log`;

    const requestOptions: request.Options = {
        method: "GET",
        qs: {
            ...options,
            follow: true,
        },
        headers: {},
        uri,
        useQuerystring: true,
        json: true,
        timeout: 1000,
    };
    config.applyToRequest(requestOptions);

    const stream = new LineStream();
    stream.on("data", data => {
        callback(data.toString());
    });

    const req = request(requestOptions, (error, response, body) => {
        if (error) {
            done(error);
        } else {
            done();
        }
    });
    req.pipe(stream);

    return req;
}
