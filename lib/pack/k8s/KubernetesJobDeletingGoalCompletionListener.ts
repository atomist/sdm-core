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
import { loadKubeConfig } from "./k8config";
import { sanitizeName } from "./KubernetesGoalScheduler";

/**
 * GoalCompletionListener that puts completed goal jobs into a ttl cache for later deletion.
 */
export class KubernetesJobDeletingGoalCompletionListenerFactory {

    private readonly cache: Map<string, { ttl: number, name: string, namespace: string }> = new Map();
    private readonly batch: k8s.Batch_v1Api;

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        const kc = loadKubeConfig();
        this.batch = kc.makeApiClient(k8s.Batch_v1Api);

        this.init();
    }

    public create(): GoalCompletionListener {
        return async gi => {
            const goalEvent = gi.completedGoal;

            if (goalEvent.state === SdmGoalState.in_process) {
                return;
            }

            const selector = `goalSetId=${goalEvent.goalSetId},creator=${sanitizeName(this.sdm.configuration.name)}`;

            const jobs = await this.batch.listJobForAllNamespaces(
                undefined,
                undefined,
                undefined,
                selector);

            logger.debug(
                `k8s jobs for goal set '${goalEvent.goalSetId}' found: '${
                    jobs.body.items.map(j => `${j.metadata.namespace}:${j.metadata.name}`).join(", ")}'`);

            const goalJobs = jobs.body.items.filter(j => {
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

            const ttl: number = _.get(this.sdm.configuration, "sdm.kubernetes.job.ttl", 1000 * 60 * 2);

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
                        try {
                            await this.batch.readNamespacedJob(job.name, job.namespace);
                            try {
                                await this.batch.deleteNamespacedJob(
                                    job.name,
                                    job.namespace,
                                    { propagationPolicy: "Background" } as any);
                            } catch (e) {
                                logger.warn(`Failed to delete k8s jobs '${job.namespace}:${job.name}': ${e.message}`);
                            }
                        } catch (e) {
                            // This is ok to ignore because the job doesn't exist any more
                        }
                        this.cache.delete(uid);
                    }
                }
            },
            _.get(this.sdm.configuration, "sdm.kubernetes.job.ttlCheckInterval", 15000));
    }
}
