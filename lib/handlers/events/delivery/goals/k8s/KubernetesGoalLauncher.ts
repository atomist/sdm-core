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
    GoalLauncher,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";
import * as cluster from "cluster";
import * as _ from "lodash";
import * as os from "os";
import { loadKubeConfig } from "./k8config";

export class KubernetesGoalLauncher implements GoalLauncher {

    constructor(private readonly options: { isolateAll?: boolean } = { isolateAll: false }) {
        this.init();
    }

    public async supports(gi: GoalInvocation): Promise<boolean> {
        return !process.env.ATOMIST_ISOLATED_GOAL &&
            (
                // Goal is marked as isolated and SDM is configured to use K8 jobs
                (gi.goal.definition.isolated && process.env.ATOMIST_GOAL_LAUNCHER === "kubernetes") ||
                // Force all goals to run isolated via env var
                process.env.ATOMIST_GOAL_LAUNCHER === "kubernetes-all" ||
                // Force all goals to run isolated via explicit configuration
                (this.options.isolateAll === true && process.env.ATOMIST_GOAL_LAUNCHER === "kubernetes")
            );
    }

    public async launch(gi: GoalInvocation): Promise<ExecuteGoalResult> {
        const { goalEvent, context } = gi;

        // Using new ATOMIST_POD_NAME to overwrite the host name default
        // This is to prevent breakage when users still have old ATOMIST_DEPLOYMENT_NAME env var defined
        const podName = process.env.ATOMIST_POD_NAME || os.hostname();
        const podNs = process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";
        const goalName = goalEvent.uniqueName.split("#")[0].toLowerCase();

        const kc = loadKubeConfig();
        const apps = kc.makeApiClient(k8s.Core_v1Api);
        const batch = kc.makeApiClient(k8s.Batch_v1Api);

        let podSpec: k8s.V1Pod;
        try {
            podSpec = (await apps.readNamespacedPod(podName, podNs)).body;
        } catch (e) {
            logger.error(`Failed to obtain parent pod spec from K8: ${e.message}`);
            return { code: 1, message: `Failed to obtain parent pod spec from K8: ${e.message}` };
        }

        const jobSpec = createJobSpecWithAffinity(podSpec, goalEvent.goalSetId);

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
                value: (context as any).id,
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

        try {
            // Check if this job was previously launched
            await batch.readNamespacedJob(jobSpec.metadata.name, podNs);
            logger.debug(`K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}' already exists. Deleting...`);
            try {
                await batch.deleteNamespacedJob(jobSpec.metadata.name, podNs, {} as any);
                logger.debug(`K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}' deleted`);
            } catch (e) {
                logger.error(`Failed to delete K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}': ${JSON.stringify(e.body)}`);
                return {
                    code: 1,
                    message: `Failed to delete K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}'`,
                };
            }
        } catch (e) {
            // This is ok to ignore as it just means the job doesn't exist
        }

        try {
            // Previous deletion might not have completed; hence the retry here
            const jobResult = (await doWithRetry<{ body: k8s.V1Job }>(
                () => batch.createNamespacedJob(podNs, jobSpec),
                `Scheduling K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}'`)).body;
            logger.info(
                `Scheduled K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}' with result: ${JSON.stringify(jobResult.status)}`);
            logger.log("silly", JSON.stringify(jobResult));
        } catch (e) {
            logger.error(`Failed to schedule K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}': ${JSON.stringify(e.body)}`);
            return {
                code: 1,
                message: `Failed to schedule K8 job '${jobSpec.metadata.name}' for goal '${goalEvent.uniqueName}'`,
            };
        }
    }

    private init(): void {
        if (cluster.isMaster && process.env.ATOMIST_GOAL_LAUNCHER === "kubernetes") {
            setInterval(() => {
                return cleanCompletedJobs()
                    .then(() => {
                        logger.debug("Finished cleaning scheduled goal jobs");
                    });
            }, configurationValue<number>("sdm.kubernetes.cleanupInterval", 1000 * 60 * 60 * 2)).unref();
        }
    }
}

/**
 * Cleanup scheduled kubernetes goal jobs
 * @returns {Promise<void>}
 */
async function cleanCompletedJobs(): Promise<void> {
    const podName = process.env.ATOMIST_DEPLOYMENT_NAME || os.hostname();
    const podNs = process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";

    const kc = loadKubeConfig();
    const apps = kc.makeApiClient(k8s.Core_v1Api);
    const batch = kc.makeApiClient(k8s.Batch_v1Api);

    let podSpec: k8s.V1Pod;
    try {
        podSpec = (await apps.readNamespacedPod(podName, podNs)).body;
    } catch (e) {
        logger.error(`Failed to obtain parent pod spec from K8: ${e.message}`);
        return;
    }

    const jobs = await batch.listNamespacedJob(podNs);

    const sdmJobs = jobs.body.items.filter(j => j.metadata.name.startsWith(`${podSpec.spec.containers[0].name}-job-`));
    const completedSdmJobs =
        sdmJobs.filter(j => j.status && j.status.completionTime && j.status.succeeded && j.status.succeeded > 0);

    if (completedSdmJobs.length > 0) {
        logger.info(`Deleting the following goal jobs from namespace '${podNs}': ${
            completedSdmJobs.join(", ")}`);

        for (const completedSdmJob of completedSdmJobs) {
            try {
                await batch.deleteNamespacedJob(
                    completedSdmJob.metadata.name,
                    completedSdmJob.metadata.namespace,
                    // progagationPolicy is needed so that pods of the job are also deleted
                    { propagationPolicy: "Background" } as any);
            } catch (e) {
                logger.warn(`Failed to delete K8 goal job '${completedSdmJob.metadata.name}': ${e.message}`);
            }
        }
    }
}

/**
 * Create a k8 Job spec with affinity to jobs for the same goal set
 * @param goalSetId
 */
function createJobSpecWithAffinity(podSpec: k8s.V1Pod, goalSetId: string): k8s.V1Job {
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
                                        goalSetId,
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

    return {
        kind: "Job",
        apiVersion: "batch/v1",
        metadata: {},
        spec: {
            template: {
                metadata: {
                    labels: {
                        goalSetId,
                    },
                },
                spec: podSpec.spec,
            },
        },
    } as any;
}

/**
 * Rewrite the volume host path to include the workspace id to prevent cross workspace content ending
 * up in the same directory.
 * @param deploymentSpec
 * @param workspaceId
 */
function rewriteCachePath(deploymentSpec: k8s.V1Job, workspaceId: string): void {
    const cachePath = configurationValue("sdm.cache.path", "/opt/data");
    const containers: k8s.V1Container[] = _.get(deploymentSpec, "spec.template.spec.containers", []);

    const cacheVolumeNames: string[] = [];
    containers.forEach(c => {
        cacheVolumeNames.push(...c.volumeMounts.filter(vm => vm.mountPath === cachePath).map(cm => cm.name));
    });

    _.uniq(cacheVolumeNames).forEach(vn => {
        const volume: k8s.V1Volume = _.get(deploymentSpec, "spec.template.spec.volumes", []).find(v => v.name === vn);
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
