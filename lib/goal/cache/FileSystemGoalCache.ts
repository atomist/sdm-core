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
    LocalProject,
    Project,
    RepoRef,
} from "@atomist/automation-client";
import {
    ProgressLog,
    spawnLog,
    StringCapturingProgressLog,
} from "@atomist/sdm";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { GoalCache } from "./goalCaching";
import uuid = require("uuid");

export class FileSystemGoalCache implements GoalCache {
    private readonly cacheDirectory: string;

    constructor(cacheDirectory: string) {
        this.cacheDirectory = cacheDirectory;
    }

    public async put(id: RepoRef, project: Project, files: string[], classifier: string = "default", log: ProgressLog): Promise<void> {
        const goalCacheDirectory = path.join(this.cacheDirectory, id.sha);
        fs.mkdirSync(goalCacheDirectory, {recursive: true});
        const tempArchive = `atomist-${uuid()}-cache.tar.gz`
        const archiveFileName = path.join(goalCacheDirectory,  classifier + ".tar.gz");
        await spawnLog("tar", ["-czf", tempArchive, ...files], {log, cwd: (project as LocalProject).baseDir});
        await spawnLog("mv", [tempArchive, archiveFileName], {log, cwd: (project as LocalProject).baseDir});
    }

    public async remove(id: RepoRef, classifier?: string): Promise<void> {
        if (classifier) {
            const archiveFileName = path.join(id.sha, classifier + ".tar.gz");
            await spawnLog("rm", ["-f", archiveFileName], {
                log: new StringCapturingProgressLog(),
                cwd: this.cacheDirectory,
            });
        } else {
            const goalArchiveDirectory = path.join(id.sha);
            await spawnLog("rm", ["-rf", goalArchiveDirectory], {
                log: new StringCapturingProgressLog(),
                cwd: this.cacheDirectory,
            });
        }
    }

    public async retrieve(id: RepoRef, project: Project, log: ProgressLog, classifier?: string): Promise<void> {
        if (classifier) {
            const archiveFileName = path.join(this.cacheDirectory, id.sha, classifier + ".tar.gz");
            if (fs.existsSync(archiveFileName)) {
                await spawnLog("tar", ["-xzf", archiveFileName], {log, cwd: (project as LocalProject).baseDir});
            } else {
                throw Error("No cache entry");
            }
        } else {
            const goalArchiveDirectory = path.join(this.cacheDirectory, id.sha);
            if (fs.existsSync(goalArchiveDirectory)) {
                const files = await promisify(fs.readdir)(goalArchiveDirectory);
                if (files.length === 0) {
                    throw Error("No cache entries");
                } else {
                    await Promise.all(files.map(async f => {
                        await spawnLog("tar", ["-xzf", path.join(goalArchiveDirectory, f)],
                            {log, cwd: (project as LocalProject).baseDir});
                    }));
                }
            } else {
                throw Error("No goal cache for this sha");
            }
        }
    }

}
