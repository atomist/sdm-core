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

import { logger } from "@atomist/automation-client";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { doWithRetry } from "@atomist/automation-client/util/retry";
import axios from "axios";
import { BuildStatusUpdater } from "./LocalBuilder";

/**
 * Update the Atomist service with the given build status
 */
export class AtomistBuildStatusUpdater implements BuildStatusUpdater {

    public updateBuildStatus(runningBuild: { repoRef: RemoteRepoRef, url: string, team: string },
                             status: "started" | "failed" | "error" | "passed" | "canceled",
                             branch: string,
                             buildNo: string): Promise<any> {
        logger.info("Telling Atomist about a %s build on %s, sha %s, url %s",
            status, branch, runningBuild.repoRef.sha, runningBuild.url);
        const url = `https://webhook.atomist.com/atomist/build/teams/${runningBuild.team}`;
        const data = {
            repository: {
                owner_name: runningBuild.repoRef.owner,
                name: runningBuild.repoRef.repo,
            },
            name: `Build #${buildNo}`,
            number: +buildNo,
            type: "push",
            build_url: runningBuild.url,
            status,
            commit: runningBuild.repoRef.sha,
            branch,
            provider: "sdm",
        };
        return doWithRetry(
            () => axios.post(url, data),
            `Update build to ${JSON.stringify(status)}`)
            .then(() => runningBuild);
    }

}
