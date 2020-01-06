/*
 * Copyright © 2020 Atomist, Inc.
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

import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import { Deferred } from "@atomist/automation-client/lib/internal/util/Deferred";
import { guid } from "@atomist/automation-client/lib/internal/util/string";
import { GitProject } from "@atomist/automation-client/lib/project/git/GitProject";
import { logger } from "@atomist/automation-client/lib/util/logger";
import { spawnLog } from "@atomist/sdm/lib/api-helper/misc/child_process";
import { GoalInvocation } from "@atomist/sdm/lib/api/goal/GoalInvocation";
import * as fs from "fs-extra";
import * as JSZip from "jszip";
import * as os from "os";
import * as path from "path";
import { resolvePlaceholder } from "../../machine/yaml/resolvePlaceholder";
import { FileSystemGoalCacheArchiveStore } from "./FileSystemGoalCacheArchiveStore";
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

export enum CompressionMethod {
    TAR,
    ZIP,
}

/**
 * Cache implementation that caches files produced by goals to an archive that can then be stored,
 * using tar and gzip to create the archives per goal invocation (and classifier if present).
 */
export class CompressingGoalCache implements GoalCache {

    public constructor(private readonly store: GoalCacheArchiveStore = new FileSystemGoalCacheArchiveStore(),
                       private readonly method: CompressionMethod = CompressionMethod.TAR) {
    }

    public async put(gi: GoalInvocation, project: GitProject, files: string[], classifier?: string): Promise<void> {
        const archiveName = "atomist-cache";
        const teamArchiveFileName = path.join(os.tmpdir(), `${archiveName}.${guid().slice(0, 7)}`);
        const slug = `${gi.id.owner}/${gi.id.repo}`;

        let teamArchiveFileNameWithSuffix = teamArchiveFileName;
        if (this.method === CompressionMethod.TAR) {
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
            teamArchiveFileNameWithSuffix += ".gz";
        } else if (this.method === CompressionMethod.ZIP) {
            const zip = new JSZip();
            for (const file of files) {
                zip.file(file, (await project.getFile(file)).getContent());
            }
            const defer = new Deferred<string>();
            zip.generateNodeStream({ type: "nodebuffer", streamFiles: true })
                .pipe(fs.createWriteStream(teamArchiveFileName))
                .on("finish", () => {
                    defer.resolve(teamArchiveFileName);
                });
            await defer.promise;
        }
        const resolvedClassifier = await resolveClassifierPath(classifier, gi);
        await this.store.store(gi, resolvedClassifier, teamArchiveFileNameWithSuffix);
    }

    public async remove(gi: GoalInvocation, classifier?: string): Promise<void> {
        const resolvedClassifier = await resolveClassifierPath(classifier, gi);
        await this.store.delete(gi, resolvedClassifier);
    }

    public async retrieve(gi: GoalInvocation, project: GitProject, classifier?: string): Promise<void> {
        const archiveName = "atomist-cache";
        const teamArchiveFileName = path.join(os.tmpdir(), `${archiveName}.${guid().slice(0, 7)}`);
        const resolvedClassifier = await resolveClassifierPath(classifier, gi);
        await this.store.retrieve(gi, resolvedClassifier, teamArchiveFileName);
        if (fs.existsSync(teamArchiveFileName)) {
            if (this.method === CompressionMethod.TAR) {
                await spawnLog("tar", ["-xzf", teamArchiveFileName], {
                    log: gi.progressLog,
                    cwd: project.baseDir,
                });
            } else if (this.method === CompressionMethod.ZIP) {
                const zip = await JSZip.loadAsync(await fs.readFile(teamArchiveFileName));
                for (const file in zip.files) {
                    if (zip.files.hasOwnProperty(file)) {
                        const entry = zip.file(file);
                        if (!entry.dir) {
                            await fs.writeFile(path.join(project.baseDir, file), await zip.file(file).async("text"));
                        }
                    }
                }
            }
        } else {
            throw Error("No cache entry");
        }
    }

}

/**
 * Interpolate information from goal invocation into the classifier.
 */
export async function resolveClassifierPath(classifier: string | undefined, gi: GoalInvocation): Promise<string> {
    if (!classifier) {
        return gi.context.workspaceId;
    }
    const wrapper = { classifier };
    await resolvePlaceholders(wrapper, v => resolvePlaceholder(v, gi.goalEvent, gi, {}));
    return gi.context.workspaceId + "/" + sanitizeClassifier(wrapper.classifier);
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
