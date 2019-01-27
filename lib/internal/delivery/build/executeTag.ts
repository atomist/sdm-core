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
    GitHubRepoRef,
    ProjectOperationCredentials,
    RemoteRepoRef,
    Success,
} from "@atomist/automation-client";
import {
    ExecuteGoal,
    ExecuteGoalResult,
    GoalInvocation,
} from "@atomist/sdm";
import {
    createTag,
    createTagReference,
    Tag,
} from "../../../util/github/ghub";
import { readSdmVersion } from "./local/projectVersioner";

export function executeTag(): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const { configuration, goalEvent, credentials, id, context } = goalInvocation;

        return configuration.sdm.projectLoader.doWithProject({ credentials, id, context, readOnly: true }, async p => {
            const version = await readSdmVersion(goalEvent.repo.owner, goalEvent.repo.name,
                goalEvent.repo.providerId, goalEvent.sha, id.branch, context);
            await createTagForStatus(id, goalEvent.sha, goalEvent.push.after.message, version, credentials);

            return Success;
        });
    };
}

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
