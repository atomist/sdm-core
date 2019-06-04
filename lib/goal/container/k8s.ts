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

import { logger } from "@atomist/automation-client";
import { Deferred } from "@atomist/automation-client/lib/internal/util/Deferred";
import { sleep } from "@atomist/automation-client/lib/internal/util/poll";
import {
    DefaultGoalNameGenerator,
    doWithProject,
    ExecuteGoal,
    ImplementationRegistration,
    ProgressLog,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";
import { LineStream } from "byline";
import * as _ from "lodash";
import * as os from "os";
import * as request from "request";
import { loadKubeConfig } from "../../pack/k8s/config";
import { readNamespace } from "../../pack/k8s/KubernetesGoalScheduler";
import {
    Container,
    ContainerRegistration,
    ContainerScheduler,
    GoalContainerSpec,
} from "./container";
import { envVars } from "./util";

export const k8sContainerScheduler: ContainerScheduler = (goal, registration) => {
    goal.addFulfillment({
        goalExecutor: executeK8sJob(goal, registration),
        name: DefaultGoalNameGenerator.generateName("container-k8s"),
        ...registration as ImplementationRegistration,
    });
};

export function executeK8sJob(goal: Container, registration: ContainerRegistration): ExecuteGoal {
    return doWithProject(async gi => {
        const { goalEvent, progressLog, project } = gi;

        const spec: GoalContainerSpec = _.merge({}, { containers: registration.containers, volumes: registration.volumes },
            (registration.callback) ? await registration.callback(registration, project, goal, goalEvent, gi.context) : {});

        const namespace = await readNamespace();

        const kc = loadKubeConfig();
        const core = kc.makeApiClient(k8s.Core_v1Api);

        const containers = spec.containers;
        for (const container of containers) {
            container.env.push(...await envVars(gi.goalEvent, gi));
        }

        const containerName = containers[0].name;
        const podSpec = await core.readNamespacedPod(os.hostname(), namespace);

        const deferred = new Deferred<k8s.V1Status>();
        const pod = podWatch(containerName, podSpec.body, deferred);

        const log = await podLog(containerName, namespace, progressLog);

        try {
            await deferred.promise;

            return {
                code: 0,
            };

        } catch (e) {
            return {
                code: 1,
            };

        } finally {
            if (!!pod) {
                pod.abort();
            }
            if (!!log) {
                log.abort();
            }
        }
    });
}

function podWatch(containerName: string, pod: k8s.V1Pod, deferred: Deferred<k8s.V1Status>): any {
    const kc = loadKubeConfig();
    const watch = new k8s.Watch(kc);
    return watch.watch(
        `/api/v1/watch/namespaces/${pod.metadata.namespace}/pods/${pod.metadata.name}`,
        {},
        (phase, obj) => {
            const podEvent = obj as k8s.V1Pod;

            const container = podEvent.status.containerStatuses.find(c => c.name === containerName);
            const exitCode = _.get(container, "state.terminated.exitCode");

            if (exitCode === 0) {
                logger.info(`Container '${containerName}' excited with 0`);
                deferred.resolve(podEvent.status);
            } else if (exitCode !== undefined && exitCode !== 0) {
                logger.info(`Container '${containerName}' excited with ${exitCode}`);
                deferred.reject(podEvent.status);
            } else {
                logger.info(`Container '${containerName}' still running`);
            }
        },
        err => logger.error(err),
    );
}

async function podLog(containerName: string, namespace: string, progressLog: ProgressLog): Promise<request.Request> {
    const kc = loadKubeConfig();
    const core = kc.makeApiClient(k8s.Core_v1Api);
    let pod;
    let startedAt;

    do {
        await sleep(500);
        pod = (await core.readNamespacedPod(os.hostname(), namespace)).body;

        const container = pod.status.containerStatuses.find(c => c.name === containerName);
        startedAt = _.get(container, "state.running.startedAt");
    } while (!startedAt);

    return followPodLog(
        kc,
        pod.metadata.name,
        pod.metadata.namespace,
        newLogs => {
            progressLog.write(newLogs);
        },
        err => logger.error(err),
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
