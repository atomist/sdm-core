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
    GitHubRepoRef,
    GitProject,
    logger,
    ProjectOperationCredentials,
    RemoteRepoRef,
} from "@atomist/automation-client";
import {
    ExecuteGoal,
    ExecuteGoalResult,
    GoalInvocation,
    LoggingProgressLog,
    ProgressLog,
    spawnLog,
} from "@atomist/sdm";
import {
    createTag,
    createTagReference,
    Tag,
} from "../../../util/github/ghub";
import { readSdmVersion } from "./local/projectVersioner";

/**
 * Create and return an execute goal object that creates a Git tag,
 * suitable for use with the [[Tag]] goal.
 *
 * @param tag If provided, create the given tag, otherwise create a prerelease version tag
 * @return Success if successful, Failure otherwise
 */
export function executeTag(tag?: string): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const { configuration, goalEvent, credentials, id, context, progressLog } = goalInvocation;

        return configuration.sdm.projectLoader.doWithProject({ credentials, id, context, readOnly: true }, async p => {
            try {
                const tagName = tag || await readSdmVersion(goalEvent.repo.owner, goalEvent.repo.name,
                    goalEvent.repo.providerId, goalEvent.sha, id.branch, context);
                await createGitTag({ project: p, tag: tagName, message: goalEvent.push.after.message, log: progressLog });
                return { code: 0, message: `Created tag '${tagName}' for ${goalEvent.repo.owner}/${goalEvent.repo.name}` };
            } catch (e) {
                const message = `Failed to create tag for ${goalEvent.repo.owner}/${goalEvent.repo.name}: ${e.message}`;
                logger.error(message);
                progressLog.write(message);
                return { code: 1, message };
            }
        });
    };
}

/** [[createTag]] function arguments. */
export interface CreateGitTagOptions {
    /** Git repository project to operate on. */
    project: GitProject;
    /** Name of tag to create and push. */
    tag: string;
    /** Optional message to associate with Git tag. */
    message?: string;
    /** Optional progress log to write updates to. */
    log?: ProgressLog;
}

/**
 * Create and push a Git tag with optional message.
 *
 * @param opts Options for creating a Git tag.
 */
export async function createGitTag(opts: CreateGitTagOptions): Promise<void> {
    if (!opts.tag) {
        throw new Error("You must provide a valid Git tag");
    }
    if (!opts.project) {
        throw new Error("You must provide a Git project");
    }
    if (!opts.log) {
        opts.log = new LoggingProgressLog("logger");
    }
    try {
        const spawnOpts = { cwd: opts.project.baseDir, log: opts.log };
        const tagArgs = ["tag", opts.tag];
        if (opts.message) {
            tagArgs.splice(1, 0, "-m", opts.message);
        }
        const tagResult = await spawnLog("git", tagArgs, spawnOpts);
        if (tagResult.code) {
            throw new Error(`git tag failed: ${tagResult.message}`);
        }
        const pushResult = await spawnLog("git", ["push", "origin", opts.tag], spawnOpts);
        if (pushResult.code) {
            throw new Error(`git push failed: ${pushResult.message}`);
        }
    } catch (e) {
        const message = `Failed to create and push git tag '${opts.tag}': ${e.message}`;
        throw e;
    }
}

/**
 * Create a GitHub tag using the GitHub API.
 *
 * @param id GitHub remote repository reference
 * @param sha Commit SHA to tag
 * @param message Tag message
 * @param version Name of tag
 * @param credentials GitHub token object
 * @deprecated use createGitTag
 */
export async function createTagForStatus(id: RemoteRepoRef,
                                         sha: string,
                                         message: string,
                                         version: string,
                                         credentials: ProjectOperationCredentials): Promise<void> {
    const tag: Tag = {
        tag: version,
        message,
        object: sha,
        type: "commit",
        tagger: {
            name: "Atomist",
            email: "info@atomist.com",
            date: new Date().toISOString(),
        },
    };

    await createTag(credentials, id as GitHubRepoRef, tag);
    await createTagReference(credentials, id as GitHubRepoRef, tag);
}
