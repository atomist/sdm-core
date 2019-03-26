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
    logger,
    Project,
    RepoRef,
} from "@atomist/automation-client";
import { LocalProject } from "@atomist/automation-client/lib/project/local/LocalProject";
import {
    ProgressLog,
    spawnLog,
    StringCapturingProgressLog,
} from "@atomist/sdm";
import * as fs from "fs";
import * as path from "path";
import { GoalArtifactCache } from "./goalCaching";

export class FileSystemGoalArtifactCache implements GoalArtifactCache {
    private cacheDirectory: string;

    constructor(cacheDirectory: string) {
        fs.mkdir(cacheDirectory, {recursive: true}, () => {});
        this.cacheDirectory = cacheDirectory;
    }

    public async putInCache(id: RepoRef, project: Project, files: string[], log: ProgressLog): Promise<void> {
        const archiveFileName = path.join(this.cacheDirectory, id.sha + ".tar.gz");
        await spawnLog("tar", ["-czf", archiveFileName, ...files], {log, cwd: (project as LocalProject).baseDir});
    }

    public async removeFromCache(id: RepoRef): Promise<void> {
        const archiveFileName = id.sha + ".tar.gz";
        await spawnLog("rm", ["-f", archiveFileName], {log: new StringCapturingProgressLog(), cwd: this.cacheDirectory});
    }

    public async retrieveFromCache(id: RepoRef, project: Project, log: ProgressLog): Promise<void> {
        const archiveFileName = path.join(this.cacheDirectory, id.sha + ".tar.gz");
        if (fs.existsSync(archiveFileName)) {
            await spawnLog("tar", ["-xzf", archiveFileName], {log, cwd: (project as LocalProject).baseDir});
        } else {
            throw Error("No cache entry");
        }
    }

}
