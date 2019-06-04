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
    guid,
    LocalProject,
} from "@atomist/automation-client";
import {
    GoalInvocation,
    spawnLog,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as path from "path";
import {
    FileSystemGoalCacheArchiveStore,
} from "./FileSystemGoalCacheArchiveStore";
import { GoalCache } from "./goalCaching";

export interface GoalCacheArchiveStore {
    /**
     * Store a compressed goal archive
     * @param gi The goal invocation thar triggered the caching
     * @param classifier The classifier of the cache
     * @param archivePath The path of the archive to be stored.
     */
    store(gi: GoalInvocation, classifier: string, archivePath: string): Promise<void>;
    /**
     * Remove a compressed goal archive
     * @param gi The goal invocation thar triggered the cache removal
     * @param classifier The classifier of the cache
     */
    delete(gi: GoalInvocation, classifier: string): Promise<void>;
    /**
     * Retrieve a compressed goal archive
     * @param gi The goal invocation thar triggered the cache retrieval
     * @param classifier The classifier of the cache
     * @param targetArchivePath The destination path where the archive needs to be stored.
     */
    retrieve(gi: GoalInvocation, classifier: string, targetArchivePath: string): Promise<void>;
}

/**
 * Cache implementation that caches files produced by goals to an archive that can then be stored,
 * using tar and gzip to create the archives per goal invocation (and classifier if present).
 */
export class CompressingGoalCache implements GoalCache {
    private readonly store: GoalCacheArchiveStore;

    public constructor(store: GoalCacheArchiveStore = new FileSystemGoalCacheArchiveStore()) {
        this.store = store;
    }

    public async put(gi: GoalInvocation, project: LocalProject, files: string[], classifier?: string): Promise<void> {
        const archiveName = "atomist-cache";
        const teamArchiveFileName = path.join(project.baseDir, `${archiveName}.${guid().slice(0, 7)}`);

        await spawnLog("tar", ["-cf", teamArchiveFileName, ...files], {
            log: gi.progressLog,
            cwd: project.baseDir,
        });
        await spawnLog("gzip", ["-3", teamArchiveFileName], {
            log: gi.progressLog,
            cwd: project.baseDir,
        });
        await this.store.store(gi, classifier, teamArchiveFileName + ".gz");
    }

    public async remove(gi: GoalInvocation, classifier?: string): Promise<void> {
        await this.store.delete(gi, classifier);
    }

    public async retrieve(gi: GoalInvocation, project: LocalProject, classifier?: string): Promise<void> {
        const archiveName = "atomist-cache";
        const teamArchiveFileName = path.join(project.baseDir, `${archiveName}.${guid().slice(0, 7)}`);
        await this.store.retrieve(gi, classifier, teamArchiveFileName);
        if (fs.existsSync(teamArchiveFileName)) {
            await spawnLog("tar", ["-xzf", teamArchiveFileName], {
                log: gi.progressLog,
                cwd: project.baseDir,
            });
        } else {
            throw Error("No cache entry");
        }
    }
}
