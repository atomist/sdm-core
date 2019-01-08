/*
 * Copyright © 2018 Atomist, Inc.
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
    Failure,
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
export async function cleanCompletedJobs() {
    const deploymentName = process.env.ATOMIST_DEPLOYMENT_NAME || configurationValue<string>("name");
    const deploymentNamespace = process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const batch = kc.makeApiClient(k8s.Batch_v1Api);
    const jobs = await batch.listNamespacedJob(deploymentNamespace);

    const sdmJobs = jobs.body.items.filter(j => j.metadata.name.startsWith(`${deploymentName}-job-`));
    const completedSdmJobs =
        sdmJobs.filter(j => j.status && j.status.completionTime && j.status.succeeded && j.status.succeeded > 0)
            .map(j => j.metadata.name);

    if (completedSdmJobs.length > 0) {
        logger.info(`Deleting the following goal jobs from namespace '${deploymentNamespace}': ${
            completedSdmJobs.join(", ")}`);

        for (const completedSdmJob of completedSdmJobs) {
            await batch.deleteNamespacedJob(completedSdmJob, deploymentNamespace, {} as any);
        }
    }
}

function jobSpecWithAffinity(goalSetId: string): string {
    return `{
    "kind": "Job",
    "apiVersion": "batch/v1",
    "metadata": {
        "name": "sample-sdm-job",
        "namespace": "default"
    },
    "spec": {
        "template": {
            "metadata": {
                "labels": {
                    "goalSetId": "${goalSetId}"
                }
            },
            "spec": {
                "affinity": {
                    "podAffinity": {
                        "preferredDuringSchedulingIgnoredDuringExecution": [
                            {
                                "weight": 100,
                                "podAffinityTerm": {
                                    "labelSelector": {
                                        "matchExpressions": [
                                            {
                                                "key": "goalSetId",
                                                "operator": "In",
                                                "values": [
                                                    "${goalSetId}"
                                                ]
                                            }
                                        ]
                                    },
                                    "topologyKey": "kubernetes.io/hostname"
                                }
                            }
                        ]
                    }
                },
                "containers": []
            }
        }
    }
}`;
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
    const deploymentName = process.env.ATOMIST_DEPLOYMENT_NAME || configurationValue<string>("name");
    const deploymentNamespace = process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const apps = kc.makeApiClient(k8s.Apps_v1Api);
    const batch = kc.makeApiClient(k8s.Batch_v1Api);

    let deploymentResult: k8s.V1Deployment;
    try {
        deploymentResult = (await apps.readNamespacedDeployment(deploymentName, deploymentNamespace)).body;
    } catch (e) {
        logger.error(`Failed to obtain parent deployment spec from K8: ${e.message}`);
        return Failure;
    }
    const goalName = goal.uniqueName.split("#")[0].toLowerCase();

    const jobSpec: k8s.V1Job = JSON.parse(jobSpecWithAffinity(goal.goalSetId));
    const affinity = jobSpec.spec.template.spec.affinity;

    const containerSpec = deploymentResult.spec.template.spec;

    jobSpec.spec.template.spec = containerSpec;
    jobSpec.spec.template.spec.affinity = affinity;

    jobSpec.metadata.name =
        `${deploymentName}-job-${goal.goalSetId.slice(0, 7)}-${goalName}`;
    jobSpec.metadata.namespace = deploymentNamespace;
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

    let jobResult: k8s.V1Job;
    try {
        // Check if this job was previously launched
        await batch.readNamespacedJob(jobSpec.metadata.name, deploymentNamespace);
        jobResult = (await batch.replaceNamespacedJob(jobSpec.metadata.name, deploymentNamespace, jobSpec, {} as any)).body;
    } catch (e) {
        jobResult = (await batch.createNamespacedJob(deploymentNamespace, jobSpec)).body;
    }

    logger.info(`Scheduling K8 job for goal '${goal.uniqueName}' with result: ${JSON.stringify(jobResult.status)}`);
    logger.log("silly", JSON.stringify(jobResult));

    // query kube to make sure the job got scheduled
    // kubectl get job <jobname> -o json
};
