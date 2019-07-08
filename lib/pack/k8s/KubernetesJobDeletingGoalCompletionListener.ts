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
    cancelableGoal,
    GoalCompletionListener,
    SdmGoalState,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import * as _ from "lodash";
import {
    deleteJob,
    deletePods,
    listJobs,
    prettyPrintError,
    sanitizeName,
} from "./KubernetesGoalScheduler";

/**
 * GoalCompletionListener factory that puts completed goal jobs into a ttl cache for later deletion.
 */
export class KubernetesJobDeletingGoalCompletionListenerFactory {

    private readonly cache: Map<string, { ttl: number, name: string, namespace: string }> = new Map();

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        this.initialize();
    }

    public create(): GoalCompletionListener {
        return async gi => {
            const goalEvent = gi.completedGoal;

            if (goalEvent.state === SdmGoalState.in_process) {
                return;
            }

            if (goalEvent.state === SdmGoalState.canceled && !(await cancelableGoal(goalEvent, gi.configuration))) {
                return;
            }

            const selector = `atomist.com/goal-set-id=${goalEvent.goalSetId},atomist.com/creator=${sanitizeName(this.sdm.configuration.name)}`;
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

    private initialize(): void {
        setInterval(async () => {
                const now = Date.now();
                for (const uid of this.cache.keys()) {
                    const job = this.cache.get(uid);
                    if (job.ttl <= now) {
                        logger.debug(`Deleting k8s job '${job.namespace}:${job.name}'`);
                        await deleteJob(job);

                        logger.debug(`Deleting k8s pods for job '${job.namespace}:${job.name}'`);
                        await deletePods(job);
                        this.cache.delete(uid);
                    }
                }
            },
            _.get(this.sdm.configuration, "sdm.k8s.job.ttlCheckInterval", 15000));
    }
}
