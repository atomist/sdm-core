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
    automationClientInstance,
    AutomationContextAware,
    configurationValue,
    doWithRetry,
    logger,
} from "@atomist/automation-client";
import {
    ExecuteGoalResult,
    GoalInvocation,
    GoalScheduler,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";
import * as cluster from "cluster";
import * as _ from "lodash";
import * as os from "os";
import { loadKubeConfig } from "./k8config";

/**
 * GoalScheduler implementation that schedules SDM goals inside k8s jobs.
 *
 * It reuses the podSpec of the deployed SDM to create a new jobSpec from.
 * Subclasses may change the spec and job creation behavior by overwriting beforeCreation
 * and/or afterCreation methods.
 */
export class KubernetesGoalScheduler implements GoalScheduler {

    constructor(private readonly options: { isolateAll?: boolean } = { isolateAll: false }) {
        this.init();
    }

    public async supports(gi: GoalInvocation): Promise<boolean> {
        return !process.env.ATOMIST_ISOLATED_GOAL &&
            (
                // Goal is marked as isolated and SDM is configured to use k8s jobs
                (gi.goal.definition.isolated && isConfiguredInEnv("kubernetes")) ||
                // Force all goals to run isolated via env var
                isConfiguredInEnv("kubernetes-all") ||
                // Force all goals to run isolated via explicit option
                (this.options.isolateAll && isConfiguredInEnv("kubernetes")) ||
                // Force all goals to run isolated via explicit configuration
                _.get(gi.configuration, "sdm.kubernetes.isolateAll", false) === true
            );
    }

    public async schedule(gi: GoalInvocation): Promise<ExecuteGoalResult> {
        const { goalEvent, context } = gi;

        // Using new ATOMIST_POD_NAME to overwrite the host name default
        // This is to prevent breakage when users still have old ATOMIST_DEPLOYMENT_NAME env var defined
        const podName = process.env.ATOMIST_POD_NAME || os.hostname();
        const podNs = process.env.ATOMIST_POD_NAMESPACE || process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";

        const kc = loadKubeConfig();
        const core = kc.makeApiClient(k8s.Core_v1Api);
        const batch = kc.makeApiClient(k8s.Batch_v1Api);

        let podSpec: k8s.V1Pod;
        try {
            podSpec = (await core.readNamespacedPod(podName, podNs)).body;
        } catch (e) {
            logger.error(`Failed to obtain parent pod spec from k8s: ${e.message}`);
            return { code: 1, message: `Failed to obtain parent pod spec from k8s: ${e.message}` };
        }

        const jobSpec = createJobSpec(podSpec, podNs, gi);
        await this.beforeCreation(gi, jobSpec);

        gi.progressLog.write(`/--`);
        gi.progressLog.write(
            `Scheduling k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.name} (${goalEvent.uniqueName})'`);
        gi.progressLog.write("\\--");

        try {
            // Check if this job was previously launched
            await batch.readNamespacedJob(jobSpec.metadata.name, jobSpec.metadata.namespace);
            logger.debug(
                `k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}' already exists. Deleting...`);
            try {
                await batch.deleteNamespacedJob(jobSpec.metadata.name, jobSpec.metadata.namespace, {} as any);
                logger.debug(`k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}' deleted`);
            } catch (e) {
                logger.error(`Failed to delete k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}': ${
                    JSON.stringify(e.body)}`);
                return {
                    code: 1,
                    message: `Failed to delete k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}'`,
                };
            }
        } catch (e) {
            // This is ok to ignore as it just means the job doesn't exist
        }

        try {
            // Previous deletion might not have completed; hence the retry here
            const jobResult = (await doWithRetry<{ body: k8s.V1Job }>(
                () => batch.createNamespacedJob(jobSpec.metadata.namespace, jobSpec),
                `Scheduling k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}'`)).body;

            await this.afterCreation(gi, jobResult);

            logger.info(
                `Scheduled k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}' with result: ${
                    JSON.stringify(jobResult.status)}`);
            logger.log("silly", JSON.stringify(jobResult));
        } catch (e) {
            logger.error(`Failed to schedule k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}': ${
                JSON.stringify(e.body)}`);
            return {
                code: 1,
                message: `Failed to schedule k8s job '${jobSpec.metadata.namespace}:${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}'`,
            };
        }
        await gi.progressLog.flush();
    }

    /**
     * Extension point for sub classes to modify k8s resources or provided jobSpec before the
     * Job gets created in k8s.
     * Note: A potentially existing job with the same name has already been deleted at this point.
     * @param gi
     * @param jobSpec
     */
    protected async beforeCreation(gi: GoalInvocation, jobSpec: k8s.V1Job): Promise<void> {
        // Intentionally left empty
    }

    /**
     * Extension point for sub classes to modify k8s resources after the job has been created.
     * The provided jobSpec contains the result of the job creation API call.
     * @param gi
     * @param jobSpec
     */
    protected async afterCreation(gi: GoalInvocation, jobSpec: k8s.V1Job): Promise<void> {
        // Intentionally left empty
    }

    private init(): void {
        if (cluster.isMaster && isConfiguredInEnv("kubernetes", "kubernetes-all")) {
            setInterval(() => {
                return this.cleanUp()
                    .then(() => {
                        logger.debug("Finished cleaning scheduled goal jobs");
                    });
            }, configurationValue<number>("sdm.kubernetes.cleanupInterval", 1000 * 60 * 60 * 2)).unref();
        }
    }

    /**
     * Extension point to allow for custom clean up logic.
     */
    protected async cleanUp(): Promise<void> {
        return cleanCompletedJobs();
    }
}

/**
 * Cleanup scheduled k8s goal jobs
 * @returns {Promise<void>}
 */
export async function cleanCompletedJobs(): Promise<void> {
    const podName = process.env.ATOMIST_POD_NAME || os.hostname();
    const podNs = process.env.ATOMIST_POD_NAMESPACE || process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";

    const kc = loadKubeConfig();
    const apps = kc.makeApiClient(k8s.Core_v1Api);
    const batch = kc.makeApiClient(k8s.Batch_v1Api);

    const selector = `creator=${sanitizeName(configurationValue<string>("name"))}`;
    const jobs = await batch.listJobForAllNamespaces(undefined, undefined, undefined, selector);

    const completedJobs =
        jobs.body.items.filter(j => j.status && j.status.completionTime && j.status.succeeded && j.status.succeeded > 0);

    if (completedJobs.length > 0) {
        logger.info(`Deleting the following k8s goal jobs: ${
            completedJobs.map(j => `${j.metadata.namespace}:${j.metadata.name}`).join(", ")}`);

        for (const completedSdmJob of completedJobs) {
            try {
                await batch.deleteNamespacedJob(
                    completedSdmJob.metadata.name,
                    completedSdmJob.metadata.namespace,
                    // propagationPolicy is needed so that pods of the job are also getting deleted
                    { propagationPolicy: "Background" } as any);
            } catch (e) {
                logger.warn(`Failed to delete k8s goal job '${completedSdmJob.metadata.namespace}:${completedSdmJob.metadata.name}': ${e.message}`);
            }
        }
    }
}

/**
 * Create a jobSpec by modifying the provided podSpec
 * @param podSpec
 * @param podNs
 * @param gi
 * @param context
 */
export function createJobSpec(podSpec: k8s.V1Pod,
                              podNs: string,
                              gi: GoalInvocation): k8s.V1Job {
    const { goalEvent, context } = gi;
    const goalName = goalEvent.uniqueName.split("#")[0].toLowerCase();

    const jobSpec = createJobSpecWithAffinity(podSpec, gi);

    jobSpec.metadata.name = `${podSpec.spec.containers[0].name}-job-${goalEvent.goalSetId.slice(0, 7)}-${goalName}`;
    jobSpec.metadata.namespace = podNs;

    jobSpec.spec.template.spec.restartPolicy = "Never";
    jobSpec.spec.template.spec.containers[0].name = jobSpec.metadata.name;

    jobSpec.spec.template.spec.containers[0].env.push({
            name: "ATOMIST_JOB_NAME",
            value: jobSpec.metadata.name,
        } as any,
        {
            name: "ATOMIST_REGISTRATION_NAME",
            value: `${automationClientInstance().configuration.name}-job-${goalEvent.goalSetId.slice(0, 7)}-${goalName}`,
        } as any,
        {
            name: "ATOMIST_GOAL_TEAM",
            value: context.workspaceId,
        } as any,
        {
            name: "ATOMIST_GOAL_TEAM_NAME",
            value: (context as any as AutomationContextAware).context.workspaceName,
        } as any,
        {
            name: "ATOMIST_GOAL_ID",
            value: (goalEvent as any).id,
        } as any,
        {
            name: "ATOMIST_GOAL_SET_ID",
            value: goalEvent.goalSetId,
        } as any,
        {
            name: "ATOMIST_GOAL_UNIQUE_NAME",
            value: goalEvent.uniqueName,
        } as any,
        {
            name: "ATOMIST_CORRELATION_ID",
            value: context.correlationId,
        } as any,
        {
            name: "ATOMIST_ISOLATED_GOAL",
            value: "true",
        } as any);

    rewriteCachePath(jobSpec, context.workspaceId);
    return jobSpec;
}

/**
 * Create a k8s Job spec with affinity to jobs for the same goal set
 * @param goalSetId
 */
function createJobSpecWithAffinity(podSpec: k8s.V1Pod, gi: GoalInvocation): k8s.V1Job {
    const { goalEvent, configuration, context } = gi;

    podSpec.spec.affinity = {
        podAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [
                {
                    weight: 100,
                    podAffinityTerm: {
                        labelSelector: {
                            matchExpressions: [
                                {
                                    key: "goalSetId",
                                    operator: "In",
                                    values: [
                                        goalEvent.goalSetId,
                                    ],
                                },
                            ],
                        },
                        topologyKey: "kubernetes.io/hostname",
                    },
                },
            ],
        },
    } as any;

    // Clean up podSpec
    // See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.13/#pod-v1-core note on nodeName
    delete podSpec.spec.nodeName;

    const labels = {
        goalSetId: goalEvent.goalSetId,
        goalId: (goalEvent as any).id,
        creator: sanitizeName(configuration.name),
        workspaceId: context.workspaceId,
    };

    const detail = {
        sdm: {
            name: configuration.name,
            version: configuration.version,
        },
        goal: {
            goalId: (goalEvent as any).id,
            goalSetId: goalEvent.goalSetId,
            uniqueName: goalEvent.uniqueName,
        },
    };

    const annotations = {
        "atomist.com/sdm": JSON.stringify(detail),
    };

    return {
        kind: "Job",
        apiVersion: "batch/v1",
        metadata: {
            labels,
            annotations,
        },
        spec: {
            template: {
                metadata: {
                    labels,
                },
                spec: podSpec.spec,
            },
        },
    } as any;
}

/**
 * Rewrite the volume host path to include the workspace id to prevent cross workspace content ending
 * up in the same directory.
 * @param jobSpec
 * @param workspaceId
 */
function rewriteCachePath(jobSpec: k8s.V1Job, workspaceId: string): void {
    const cachePath = configurationValue("sdm.cache.path", "/opt/data");
    const containers: k8s.V1Container[] = _.get(jobSpec, "spec.template.spec.containers", []);

    const cacheVolumeNames: string[] = [];
    containers.forEach(c => {
        cacheVolumeNames.push(...c.volumeMounts.filter(vm => vm.mountPath === cachePath).map(cm => cm.name));
    });

    _.uniq(cacheVolumeNames).forEach(vn => {
        const volume: k8s.V1Volume = _.get(jobSpec, "spec.template.spec.volumes", []).find(v => v.name === vn);
        if (!!volume && !!volume.hostPath && !!volume.hostPath.path) {
            const path = volume.hostPath.path;
            if (!path.endsWith(workspaceId) || !path.endsWith(`${workspaceId}/`)) {
                if (path.endsWith("/")) {
                    volume.hostPath.path = `${path}${workspaceId}`;
                } else {
                    volume.hostPath.path = `${path}/${workspaceId}`;
                }
            }
        }
    });
}

/**
 * Checks if one of the provided values is configured in ATOMIST_GOAL_SCHEDULER or -
 * for backwards compatibility reasons - ATOMIST_GOAL_LAUNCHER.
 * @param values
 */
function isConfiguredInEnv(...values: string[]): boolean {
    const value = process.env.ATOMIST_GOAL_SCHEDULER || process.env.ATOMIST_GOAL_LAUNCHER;
    return values.includes(value);
}

function sanitizeName(name: string): string {
    return name.replace(/@/g, "").replace(/\//g, ".");
}
