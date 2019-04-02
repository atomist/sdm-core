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
    GitProject,
    LocalProject,
    Project,
} from "@atomist/automation-client";
import {
    GoalInvocation,
    spawnLog,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as path from "path";
import * as uuid from "uuid";
import { GoalCache } from "./goalCaching";

/**
 * Cache implementation that caches files produced by goals to a local filesystem,
 * using tar to create the archives per goal invocation (and classifier if present).
 */
export class FileSystemGoalCache implements GoalCache {

    constructor(private readonly cacheDirectory: string) {
    }

    public async put(gi: GoalInvocation, project: GitProject, files: string[], classifier?: string): Promise<void> {
        const cacheDir = await this.getCacheDirectory(classifier);
        const archiveName = this.getArchiveName(gi);
        const teamArchiveFileName = path.join(cacheDir, `${archiveName}.${uuid().slice(0, 7)}`);
        const archiveFileName = path.join(cacheDir, archiveName);

        await spawnLog("tar", ["-czf", teamArchiveFileName, ...files], {
            log: gi.progressLog,
            cwd: (project as LocalProject).baseDir,
        });
        await spawnLog("mv", [teamArchiveFileName, archiveFileName], {
            log: gi.progressLog,
            cwd: (project as LocalProject).baseDir,
        });
    }

    public async remove(gi: GoalInvocation, classifier?: string): Promise<void> {
        const archiveFileName = await this.getArchiveFileName(gi, classifier);
        await spawnLog("rm", ["-f", archiveFileName], {
            log: gi.progressLog,
        });
    }

    public async retrieve(gi: GoalInvocation, project: Project, classifier?: string): Promise<void> {
        const archiveFileName = await this.getArchiveFileName(gi, classifier);
        if (fs.existsSync(archiveFileName)) {
            await spawnLog("tar", ["-xzf", archiveFileName], {
                log: gi.progressLog,
                cwd: (project as LocalProject).baseDir,
            });
        } else {
            throw Error("No cache entry");
        }
    }

    private async getCacheDirectory(classifier: string = "default"): Promise<string> {
        const cacheDir = path.join(this.cacheDirectory, classifier);
        await fs.mkdirs(cacheDir);
        return cacheDir;
    }

    private getArchiveName(gi: GoalInvocation): string {
       return `${gi.goalEvent.sha}-cache.tar.gz`;
    }

    private async getArchiveFileName(gi: GoalInvocation, classifier: string): Promise<string> {
        const cacheDir = await this.getCacheDirectory(classifier);
        const archiveName = this.getArchiveName(gi);
        return path.join(cacheDir, archiveName);
    }

}
