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
    HandlerContext,
    HandlerResult,
    logger,
} from "@atomist/automation-client";
import { configurationValue } from "@atomist/automation-client/configuration";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import { SuccessIsReturn0ErrorFinder } from "@atomist/automation-client/util/spawned";
import { IsolatedGoalLauncher } from "@atomist/sdm";
import { LoggingProgressLog } from "@atomist/sdm/api-helper/log/LoggingProgressLog";
import { StringCapturingProgressLog } from "@atomist/sdm/api-helper/log/StringCapturingProgressLog";
import { spawnAndWatch } from "@atomist/sdm/api-helper/misc/spawned";
import { SdmGoal } from "@atomist/sdm/api/goal/SdmGoal";
import { ProgressLog } from "@atomist/sdm/spi/log/ProgressLog";
import { OnAnyRequestedSdmGoal } from "@atomist/sdm/typings/types";
import * as cluster from "cluster";
import * as fs from "fs-extra";
import * as path from "path";

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

    let log = new StringCapturingProgressLog();

    await spawnAndWatch({
            command: "kubectl",
            args: ["get", "jobs", "-n", deploymentNamespace, "-o", "json"],
        },
        {},
        log,
        {
            errorFinder: SuccessIsReturn0ErrorFinder,
            logCommand: false,
        },
    );

    const jobs = JSON.parse(log.log).items;
    const sdmJobs = jobs.filter(j => j.metadata.name.startsWith(`${deploymentName}-job-`));
    const completedSdmJobs =
        sdmJobs.filter(j => j.status && j.status.completionTime && j.status.succeeded && j.status.succeeded > 0)
            .map(j => j.metadata.name);

    if (completedSdmJobs.length > 0) {
        logger.info(`Deleting the following goal jobs from namespace '${deploymentNamespace}': ${
            completedSdmJobs.join(", ")}`);

        log = new LoggingProgressLog("");

        for (const completedSdmJob of completedSdmJobs) {
            await spawnAndWatch({
                    command: "kubectl",
                    args: ["delete", "job", completedSdmJob, "-n" , deploymentNamespace],
                },
                {},
                log,
                {
                    errorFinder: SuccessIsReturn0ErrorFinder,
                },
            );
        }
    }
}

/**
 * Launch a goal as a kubernetes job
 * @param {OnAnyRequestedSdmGoal.SdmGoal} goal
 * @param {HandlerContext} ctx
 * @param {ProgressLog} progressLog
 * @returns {Promise<HandlerResult>}
 * @constructor
 */
export const KubernetesIsolatedGoalLauncher = async (goal: OnAnyRequestedSdmGoal.SdmGoal,
                                                     ctx: HandlerContext,
                                                     progressLog: ProgressLog): Promise<HandlerResult> => {
    const deploymentName = process.env.ATOMIST_DEPLOYMENT_NAME || configurationValue<string>("name");
    const deploymentNamespace = process.env.ATOMIST_DEPLOYMENT_NAMESPACE || "default";

    const log = new StringCapturingProgressLog();

    let result = await spawnAndWatch({
            command: "kubectl",
            args: ["get", "deployment", deploymentName, "-n", deploymentNamespace, "-o", "json"],
        },
        {},
        log,
        {
            errorFinder: SuccessIsReturn0ErrorFinder,
            logCommand: false,
        },
    );

    if (result.code !== 0) {
        return result;
    }

    const jobSpec = JSON.parse(JobSpec);
    const containerSpec = JSON.parse(log.log).spec.template.spec;
    jobSpec.spec.template.spec = containerSpec;

    jobSpec.metadata.name =
        `${deploymentName}-job-${goal.goalSetId.slice(0, 7)}-${goal.uniqueName.toLocaleLowerCase()}`;
    jobSpec.metadata.namespace = deploymentNamespace;
    jobSpec.spec.template.spec.restartPolicy = "Never";
    jobSpec.spec.template.spec.containers[0].name = jobSpec.metadata.name;
    jobSpec.spec.template.spec.containers[0].env.push({
            name: "ATOMIST_JOB_NAME",
            value: jobSpec.metadata.name,
        },
        {
            name: "ATOMIST_REGISTRATION_NAME",
            value: `${automationClientInstance().configuration.name}-job-${goal.goalSetId.slice(0, 7)}-${goal.uniqueName.toLocaleLowerCase()}`,
        },
        {
            name: "ATOMIST_GOAL_TEAM",
            value: ctx.teamId,
        },
        {
            name: "ATOMIST_GOAL_TEAM_NAME",
            value: (ctx as any as AutomationContextAware).context.teamName,
        },
        {
            name: "ATOMIST_GOAL_ID",
            value: goal.id,
        },
        {
            name: "ATOMIST_CORRELATION_ID",
            value: ctx.correlationId,
        },
        {
            name: "ATOMIST_ISOLATED_GOAL",
            value: "true",
        });

    const tempfile = require("tempfile")(".json");
    await fs.writeFile(tempfile, JSON.stringify(jobSpec, null, 2));

    // Check if this job was previously launched
    result = await spawnAndWatch({
            command: "kubectl",
            args: ["get", "job", jobSpec.metadata.name, "-n", deploymentNamespace],
        },
        {},
        progressLog,
        {
            errorFinder: SuccessIsReturn0ErrorFinder,
        },
    );

    if (result.code !== 0) {
        return spawnAndWatch({
                command: "kubectl",
                args: ["apply", "-f", tempfile],
            },
            {},
            progressLog,
            {
                errorFinder: SuccessIsReturn0ErrorFinder,
            },
        );
    } else {
        return spawnAndWatch({
                command: "kubectl",
                args: ["replace", "--force", "-f", tempfile],
            },
            {},
            progressLog,
            {
                errorFinder: SuccessIsReturn0ErrorFinder,
            },
        );
    }
    // query kube to make sure the job got scheduled
    // kubectl get job <jobname> -o json
};

const JobSpec = `{
    "kind" : "Job",
    "apiVersion" : "batch/v1",
    "metadata" : {
      "name" : "sample-sdm-job",
      "namespace" : "default"
    },
    "spec" : {
      "template" : {
        "spec" : {
          "containers" : []
        }
      }
    }
  }`;

export interface KubernetesOptions {
    name: string;
    environment: string;

    ns?: string;
    imagePullSecret?: string;
    port?: number;
    path?: string;
    host?: string;
    protocol?: string;
    replicas?: number;
}

/**
 * Sets kubernetes deployment specific data to an SdmGoal
 * @param {SdmGoal} goal
 * @param {KubernetesOptions} options
 * @param {GitProject} p
 * @returns {Promise<SdmGoal>}
 */
export async function createKubernetesData(goal: SdmGoal, options: KubernetesOptions, p: GitProject): Promise<SdmGoal> {
    const deploymentSpec = await readKubernetesSpec(p, "deployment.json");
    const serviceSpec = await readKubernetesSpec(p, "service.json");
    return {
        ...goal,
        data: JSON.stringify({
            kubernetes: {
                ...options,
                deploymentSpec,
                serviceSpec,
            },
        }),
    };
}

async function readKubernetesSpec(p: GitProject, name: string): Promise<string> {
    const specPath = path.join(".atomist", "kubernetes", name);
    if (p.fileExistsSync(specPath)) {
        return (await p.getFile(specPath)).getContent();
    } else {
        return undefined;
    }
}
