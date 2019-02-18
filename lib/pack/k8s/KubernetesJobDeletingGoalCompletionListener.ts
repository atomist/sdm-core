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
import {
    GoalCompletionListener,
    SdmGoalState,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";
import * as _ from "lodash";
import { loadKubeConfig } from "./config";
import {
    listJobs,
    prettyPrintError,
    sanitizeName,
} from "./KubernetesGoalScheduler";

/**
 * GoalCompletionListener factory that puts completed goal jobs into a ttl cache for later deletion.
 */
export class KubernetesJobDeletingGoalCompletionListenerFactory {

    private readonly cache: Map<string, { ttl: number, name: string, namespace: string }> = new Map();
    private readonly batch: k8s.Batch_v1Api;
    private readonly core: k8s.Core_v1Api;

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        const kc = loadKubeConfig();
        this.batch = kc.makeApiClient(k8s.Batch_v1Api);
        this.core = kc.makeApiClient(k8s.Core_v1Api);

        this.init();
    }

    public create(): GoalCompletionListener {
        return async gi => {
            const goalEvent = gi.completedGoal;

            if (goalEvent.state === SdmGoalState.in_process) {
                return;
            }

            const selector = `atomist.com/goalSetId=${goalEvent.goalSetId},atomist.com/creator=${sanitizeName(this.sdm.configuration.name)}`;
            let jobs;

            try {
                jobs = await listJobs(selector);
            } catch (e) {
                logger.warn(`Failed to read k8s jobs: ${prettyPrintError(e)}`);
                return;
            }

            logger.debug(
                `Found k8s jobs for goal set '${goalEvent.goalSetId}': '${
                    jobs.map(j => `${j.metadata.namespace}:${j.metadata.name}`).join(", ")}'`);

            const goalJobs = jobs.filter(j => {
                const annotations = j.metadata.annotations;
                if (!!annotations && !!annotations["atomist.com/sdm"]) {
                    const sdmAnnotation = JSON.parse(annotations["atomist.com/sdm"]);
                    return sdmAnnotation.goal.uniqueName === goalEvent.uniqueName;
                }
                return false;
            });

            logger.debug(
                `Matching k8s job for goal '${goalEvent.uniqueName}' found: '${
                    goalJobs.map(j => `${j.metadata.namespace}:${j.metadata.name}`).join(", ")}'`);

            const ttl: number = _.get(this.sdm.configuration, "sdm.k8s.job.ttl", 1000 * 60 * 2);

            for (const goalJob of goalJobs) {
                this.cache.set(
                    goalJob.metadata.uid,
                    {
                        ttl: Date.now() + ttl,
                        name: goalJob.metadata.name,
                        namespace: goalJob.metadata.namespace,
                    });
            }
        };
    }

    private init(): void {
        setInterval(async () => {
                const now = Date.now();
                for (const uid of this.cache.keys()) {
                    const job = this.cache.get(uid);
                    if (job.ttl <= now) {
                        logger.debug(`Deleting k8s job '${job.namespace}:${job.name}'`);

                        // First delete the job
                        await this.deleteJob(job);

                        logger.debug(`Deleting k8s pods for job '${job.namespace}:${job.name}'`);
                        // Next, delete all still existing jobs
                        await this.deletePods(job);
                        this.cache.delete(uid);
                    }
                }
            },
            _.get(this.sdm.configuration, "sdm.k8s.job.ttlCheckInterval", 15000));
    }

    private async deleteJob(job: { name: string, namespace: string }): Promise<void> {
        try {
            await this.batch.readNamespacedJob(job.name, job.namespace);
            try {
                await this.batch.deleteNamespacedJob(
                    job.name,
                    job.namespace,
                    { propagationPolicy: "Foreground" } as any);
            } catch (e) {
                logger.warn(`Failed to delete k8s jobs '${job.namespace}:${job.name}': ${
                    prettyPrintError(e)}`);
            }
        } catch (e) {
            // This is ok to ignore because the job doesn't exist any more
        }
    }

    private async deletePods(job: { name: string, namespace: string }): Promise<void> {
        try {
            const selector = `job-name=${job.name}`;
            const pods = await this.core.listNamespacedPod(
                job.namespace,
                undefined,
                undefined,
                undefined,
                undefined,
                selector);
            if (pods.body && pods.body.items) {
                for (const pod of pods.body.items) {
                    try {
                        await this.core.deleteNamespacedPod(pod.metadata.name, pod.metadata.namespace, {} as any);
                    } catch (e) {
                        // Probably ok because pod might be gone already
                        logger.debug(
                            `Failed to delete k8s pod '${pod.metadata.namespace}:${pod.metadata.name}': ${
                                prettyPrintError(e)}`);
                    }
                }
            }
        } catch (e) {
            logger.warn(`Failed to list pods for k8s job '${job.namespace}:${job.name}': ${
                prettyPrintError(e)}`);
        }
    }
}
