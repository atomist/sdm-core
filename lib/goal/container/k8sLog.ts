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

import * as k8s from "@kubernetes/client-node";
import { LineStream } from "byline";
import * as request from "request";

export interface FollowLogOptions {
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
