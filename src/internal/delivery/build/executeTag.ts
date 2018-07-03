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

import { Success } from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import {
    ExecuteGoal,
    GoalInvocation,
} from "@atomist/sdm";
import { ExecuteGoalResult } from "@atomist/sdm/api/goal/ExecuteGoalResult";
import { ProjectLoader } from "@atomist/sdm/spi/project/ProjectLoader";
import {
    createTag,
    createTagReference,
    Tag,
} from "../../../util/github/ghub";
import { readSdmVersion } from "./local/projectVersioner";

export function executeTag(projectLoader: ProjectLoader): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const { sdmGoal, credentials, id, context } = goalInvocation;

        return projectLoader.doWithProject({ credentials, id, context, readOnly: true }, async p => {
            const version = await readSdmVersion(sdmGoal.repo.owner, sdmGoal.repo.name,
                sdmGoal.repo.providerId, sdmGoal.sha, id.branch, context);
            await createTagForStatus(id, sdmGoal.sha, sdmGoal.push.after.message, version, credentials);

            return Success;
        });
    };
}

export async function createTagForStatus(id: RemoteRepoRef,
                                         sha: string,
                                         message: string,
                                         version: string,
                                         credentials: ProjectOperationCredentials) {
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
