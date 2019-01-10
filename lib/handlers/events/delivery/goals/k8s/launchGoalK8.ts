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
    HandlerContext,
    HandlerResult,
    logger,
} from "@atomist/automation-client";
import {
    IsolatedGoalLauncher,
    OnAnyRequestedSdmGoal,
    SdmGoalEvent,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";
import * as cluster from "cluster";
import * as _ from "lodash";
import * as os from "os";
import { loadKubeConfig } from "./k8config";

/**
 * Create the Kubernetes IsolatedGoalLauncher.
 * Note: This also schedules a clean up task to delete successfully completed jobs.
 * @returns {IsolatedGoalLauncher}
 */
export function createKubernetesGoalLauncher(): IsolatedGoalLauncher {

    if (cluster.isMaster) {
        setInterval(() => {
            return cleanCompletedJobs()
                .then(() => {
                    logger.debug("Finished cleaning scheduled goal jobs");
                });
        }, configurationValue<number>("sdm.kubernetes.cleanupInterval", 1000 * 60 * 60 * 2));
    }

    return KubernetesIsolatedGoalLauncher;
}

/**
 * Cleanup scheduled kubernetes goal jobs
 * @returns {Promise<void>}
 */
async function cleanCompletedJobs() {
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
        return { code: 1, message: `Failed to obtain parent pod spec from K8: ${e.message}` };
    }

    const jobs = await batch.listNamespacedJob(podNs);

    const sdmJobs = jobs.body.items.filter(j => j.metadata.name.startsWith(`${podSpec.spec.containers[0].name}-job-`));
    const completedSdmJobs =
        sdmJobs.filter(j => j.status && j.status.completionTime && j.status.succeeded && j.status.succeeded > 0);

    if (completedSdmJobs.length > 0) {
        logger.info(`Deleting the following goal jobs from namespace '${podNs}': ${
            completedSdmJobs.join(", ")}`);

        for (const completedSdmJob of completedSdmJobs) {
            await batch.deleteNamespacedJob(completedSdmJob.metadata.name, completedSdmJob.metadata.namespace, {} as any);
        }
    }
}

/**
 * Launch a goal as a kubernetes job
 * @param {OnAnyRequestedSdmGoal.SdmGoal} goal
 * @param {HandlerContext} ctx
 * @returns {Promise<HandlerResult>}
 * @constructor
 */
export const KubernetesIsolatedGoalLauncher = async (goal: SdmGoalEvent,
                                                     ctx: HandlerContext): Promise<HandlerResult> => {
    const podName = process.env.ATOMIST_DEPLOYMENT_NAME || os.hostname();
    const podNs = process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";
    const goalName = goal.uniqueName.split("#")[0].toLowerCase();

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

    const jobSpec = createJobSpecWithAffinity(podSpec, goal.goalSetId);

    jobSpec.metadata.name = `${podSpec.spec.containers[0].name}-job-${goal.goalSetId.slice(0, 7)}-${goalName}`;
    jobSpec.metadata.namespace = podNs;

    jobSpec.spec.template.spec.restartPolicy = "Never";
    jobSpec.spec.template.spec.containers[0].name = jobSpec.metadata.name;

    jobSpec.spec.template.spec.containers[0].env.push({
            name: "ATOMIST_JOB_NAME",
            value: jobSpec.metadata.name,
        } as any,
        {
            name: "ATOMIST_REGISTRATION_NAME",
            value: `${automationClientInstance().configuration.name}-job-${goal.goalSetId.slice(0, 7)}-${goalName}`,
        } as any,
        {
            name: "ATOMIST_GOAL_TEAM",
            value: ctx.workspaceId,
        } as any,
        {
            name: "ATOMIST_GOAL_TEAM_NAME",
            value: (ctx as any as AutomationContextAware).context.workspaceName,
        } as any,
        {
            name: "ATOMIST_GOAL_ID",
            value: (goal as any).id,
        } as any,
        {
            name: "ATOMIST_GOAL_SET_ID",
            value: goal.goalSetId,
        } as any,
        {
            name: "ATOMIST_GOAL_UNIQUE_NAME",
            value: goal.uniqueName,
        } as any,
        {
            name: "ATOMIST_CORRELATION_ID",
            value: ctx.correlationId,
        } as any,
        {
            name: "ATOMIST_ISOLATED_GOAL",
            value: "true",
        } as any);

    rewriteCachePath(jobSpec, ctx.workspaceId);

    try {
        // Check if this job was previously launched
        await batch.readNamespacedJob(jobSpec.metadata.name, podNs);
        logger.debug(`K8 job '${jobSpec.metadata.name}' for goal '${goal.uniqueName}' already exists. Deleting...`);
        await batch.deleteNamespacedJob(jobSpec.metadata.name, podNs, {} as any);
        logger.debug(`K8 job '${jobSpec.metadata.name}' for goal '${goal.uniqueName}' deleted`);
    } catch (e) {
        logger.error(`Failed to delete K8 job '${jobSpec.metadata.name}' for goal '${goal.uniqueName}': ${JSON.stringify(e.body)}`);
        return { code: 1, message: `Failed to delete K8 job '${jobSpec.metadata.name}' for goal '${goal.uniqueName}'` };
    }

    try {
        const jobResult = (await batch.createNamespacedJob(podNs, jobSpec)).body;
        logger.info(
            `Scheduled K8 job '${jobSpec.metadata.name}' for goal '${goal.uniqueName}' with result: ${JSON.stringify(jobResult.status)}`);
        logger.log("silly", JSON.stringify(jobResult));
    } catch (e) {
        logger.error(`Failed to schedule K8 job '${jobSpec.metadata.name}' for goal '${goal.uniqueName}': ${JSON.stringify(e.body)}`);
        return {
            code: 1,
            message: `Failed to schedule K8 job '${jobSpec.metadata.name}' for goal '${goal.uniqueName}'`,
        };
    }
};

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

    return {
        kind: "Job",
        apiVersion: "batch/v1",
        metadata: {
        },
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
