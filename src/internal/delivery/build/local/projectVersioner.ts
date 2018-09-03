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
    HandlerContext,
    Success,
} from "@atomist/automation-client";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import { addressEvent } from "@atomist/automation-client/spi/message/MessageClient";
import {
    ExecuteGoal,
    GoalInvocation,
    SdmGoalEvent,
} from "@atomist/sdm";
import { ExecuteGoalResult } from "@atomist/sdm/api/goal/ExecuteGoalResult";
import { ProgressLog } from "@atomist/sdm/spi/log/ProgressLog";
import { codeLine } from "@atomist/slack-messages";
import * as _ from "lodash";
import {
    SdmVersion,
    SdmVersionRootType,
} from "../../../../ingesters/sdmVersionIngester";
import { SdmVersionForCommit } from "../../../../typings/types";

export type ProjectVersioner =
    (status: SdmGoalEvent, p: GitProject, log: ProgressLog) => Promise<string>;

/**
 * Version the project with a build specific version number
 * @param projectLoader used to load projects
 * @param projectVersioner decides on the version string
 */
export function executeVersioner(projectVersioner: ProjectVersioner): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const { configuration, sdmGoal, credentials, id, context, progressLog } = goalInvocation;

        return configuration.sdm.projectLoader.doWithProject({ credentials, id, context, readOnly: false }, async p => {
            const version = await projectVersioner(sdmGoal, p, progressLog);
            const sdmVersion: SdmVersion = {
                sha: sdmGoal.sha,
                branch: id.branch,
                version,
                repo: {
                    owner: sdmGoal.repo.owner,
                    name: sdmGoal.repo.name,
                    providerId: sdmGoal.repo.providerId,
                },
            };
            await context.messageClient.send(sdmVersion, addressEvent(SdmVersionRootType));
            return {
                ...Success,
                description: `Versioned ${codeLine(version)}`,
            };
        });
    };
}

export async function readSdmVersion(owner: string,
                                     name: string,
                                     providerId: string,
                                     sha: string,
                                     branch: string,
                                     context: HandlerContext): Promise<string> {
    const version = await context.graphClient.query<SdmVersionForCommit.Query, SdmVersionForCommit.Variables>({
            name: "SdmVersionForCommit",
            variables: {
                name: [name],
                owner: [owner],
                providerId: [providerId],
                sha: [sha],
                branch: [branch],
            },
        });
    return _.get(version, "SdmVersion[0].version");
}
