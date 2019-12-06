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
    // GitCommandGitProject,
    GitProject,
    guid,
    logger,
} from "@atomist/automation-client";
import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import {
    GoalInvocation,
    PushListenerInvocation,
    spawnLog,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { resolvePlaceholder } from "../resolvePlaceholder";
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

    public async put(gi: GoalInvocation, project: GitProject, files: string[], classifier?: string): Promise<void> {
        const archiveName = "atomist-cache";
        const teamArchiveFileName = path.join(os.tmpdir(), `${archiveName}.${guid().slice(0, 7)}`);
        const slug = `${gi.id.owner}/${gi.id.repo}`;

        const tarResult = await spawnLog("tar", ["-cf", teamArchiveFileName, ...files], {
            log: gi.progressLog,
            cwd: project.baseDir,
        });
        if (tarResult.code) {
            const message = `Failed to create tar archive '${teamArchiveFileName}' for ${slug}`;
            logger.error(message);
            gi.progressLog.write(message);
            return;
        }
        const gzipResult = await spawnLog("gzip", ["-3", teamArchiveFileName], {
            log: gi.progressLog,
            cwd: project.baseDir,
        });
        if (gzipResult.code) {
            const message = `Failed to gzip tar archive '${teamArchiveFileName}' for ${slug}`;
            logger.error(message);
            gi.progressLog.write(message);
            return;
        }
        const resolvedClassifier = await resolveClassifier(classifier, gi, project);
        await this.store.store(gi, resolvedClassifier, teamArchiveFileName + ".gz");
    }

    public async remove(gi: GoalInvocation, classifier?: string): Promise<void> {
        const resolvedClassifier = await resolveClassifier(classifier, gi);
        await this.store.delete(gi, resolvedClassifier);
    }

    public async retrieve(gi: GoalInvocation, project: GitProject, classifier?: string): Promise<void> {
        const archiveName = "atomist-cache";
        const teamArchiveFileName = path.join(os.tmpdir(), `${archiveName}.${guid().slice(0, 7)}`);
        const resolvedClassifier = await resolveClassifier(classifier, gi, project);
        await this.store.retrieve(gi, resolvedClassifier, teamArchiveFileName);
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

/**
 * Interpolate information from goal invocation into the classifier.
 */
async function resolveClassifier(classifier: string | undefined, gi: GoalInvocation, project?: GitProject): Promise<string | undefined> {
    if (!classifier) {
        return classifier;
    }
    const wrapper = { classifier };
    // const project = !!p ? p : await GitCommandGitProject.cloned(gi.credentials, gi.id);
    const pli: PushListenerInvocation = {
        ...gi,
        project,
        push: gi.goalEvent.push,
    };
    await resolvePlaceholders(wrapper, v => resolvePlaceholder(v, pli));
    return sanitizeClassifier(wrapper.classifier);
}

/**
 * Sanitize classifier for use in path.  Replace any characters
 * which might cause problems on POSIX or MS Windows with "_",
 * including path separators.  Ensure resulting file is not "hidden".
 */
export function sanitizeClassifier(classifier: string): string {
    return classifier.replace(/[^-.0-9A-Za-z_+]/g, "_")
        .replace(/^\.+/, ""); // hidden
}
