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
    HandlerResult,
    Success,
} from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import { SuccessIsReturn0ErrorFinder } from "@atomist/automation-client/util/spawned";
import {
    ExecuteGoal,
    GoalInvocation,
    PrepareForGoalExecution,
} from "@atomist/sdm";
import { LoggingProgressLog } from "@atomist/sdm/api-helper/log/LoggingProgressLog";
import { spawnAndWatch } from "@atomist/sdm/api-helper/misc/spawned";
import { projectConfigurationValue } from "@atomist/sdm/api-helper/project/configuration/projectConfiguration";
import { ExecuteGoalResult } from "@atomist/sdm/api/goal/ExecuteGoalResult";
import { ProjectLoader } from "@atomist/sdm/spi/project/ProjectLoader";
import * as fs from "fs-extra";
import * as p from "path";
import { createStatus } from "../../../../../util/github/ghub";
import { ProjectIdentifier } from "../projectIdentifier";
import { NpmPreparations } from "./npmBuilder";

/**
 * Execute npm publish
 *
 * Tags with branch-name unless the `tag` option is specified
 *
 * @param {ProjectLoader} projectLoader
 * @param {ProjectIdentifier} projectIdentifier
 * @param {PrepareForGoalExecution[]} preparations
 * @return {ExecuteGoal}
 */
export function executePublish(
    projectLoader: ProjectLoader,
    projectIdentifier: ProjectIdentifier,
    preparations: PrepareForGoalExecution[] = NpmPreparations,
    options: NpmOptions,
): ExecuteGoal {

    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const { credentials, id, context } = goalInvocation;
        return projectLoader.doWithProject({ credentials, id, context, readOnly: false }, async project => {
            for (const preparation of preparations) {
                const pResult = await preparation(project, goalInvocation);
                if (pResult.code !== 0) {
                    return pResult;
                }
            }

            await configure(options, project);

            const args = [
                p.join(__dirname, "..", "..", "..", "..", "..", "scripts", "npm-publish.bash"),
            ];
            if (options.registry) {
                args.push("--registry", options.registry);
            }
            const access = await projectConfigurationValue("npm.publish.access", project, options.access);
            if (access) {
                args.push("--access", access);
            }
            if (options.tag) {
                args.push("--tag", options.tag);
            } else {
                args.push("--tag", gitBranchToNpmTag(id.branch));
            }

            const result: ExecuteGoalResult = await spawnAndWatch(
                { command: "bash", args },
                { cwd: project.baseDir },
                goalInvocation.progressLog,
            );

            if (result.code === 0) {
                const pi = await projectIdentifier(project);
                const url = `${options.registry}/${pi.name}/-/${pi.name}-${pi.version}.tgz`;
                result.targetUrl = url;

                if (options.status) {
                    await createStatus(
                        credentials,
                        id as GitHubRepoRef,
                        {
                            context: "npm/atomist/package",
                            description: "NPM package",
                            target_url: url,
                            state: "success",
                        });
                }
            }

            return result;
        });
    };
}

export async function deleteBranchTag(branch: string, p: GitProject, options: NpmOptions): Promise<HandlerResult> {
    const pj = await p.getFile("package.json");
    if (pj) {
        const tag = gitBranchToNpmTag(branch);
        const name = JSON.parse(await pj.getContent()).name;

        await configure(options, p);
        const result = await spawnAndWatch({
                command: "npm",
                args: ["dist-tags", "rm", name, tag],
            },
            {
                cwd: p.baseDir,
            },
            new LoggingProgressLog("npm dist-tag rm"),
            {
                errorFinder: SuccessIsReturn0ErrorFinder,
            });

        return result;
    }
    return Success;
}

/**
 * Create an npmrc file for the package.
 */
async function configure(options: NpmOptions, project: { baseDir: string }): Promise<NpmOptions> {
    await fs.writeFile(p.join(project.baseDir, ".npmrc"), options.npmrc, { mode: 0o600 });
    return options;
}

/**
 * NPM options used when publishing NPM modules.
 */
export interface NpmOptions {
    /** The contents of a .npmrc file, typically containing authentication information */
    npmrc: string;
    /** Optional registry, use NPM default if not present, currently "https://registry.npmjs.org" */
    registry?: string;
    /** Optional publication access, use NPM default if not present, currently "restricted" */
    access?: "public" | "restricted";
    /** Optional publication tag, use NPM default if not present, currently "latest" */
    tag?: string;
    /** Optional flag, to indicate if a status should be created on the SCM containing a link to the package */
    status?: boolean;
}

export function gitBranchToNpmTag(branchName: string) {
    const safeName = branchName.replace(/\//g, "-");
    return "branch-" + safeName;
}
