import {
    GitProject,
    guid,
    LocalProject,
    Project,
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
    private store: GoalCacheArchiveStore;

    public constructor(store: GoalCacheArchiveStore = new FileSystemGoalCacheArchiveStore()) {
        this.store = store;
    }

    public async put(gi: GoalInvocation, project: GitProject, files: string[], classifier?: string): Promise<void> {
        const archiveName = "atomistgoalcache";
        const teamArchiveFileName = path.join(project.baseDir, `${archiveName}.${guid().slice(0, 7)}`);

        await spawnLog("tar", ["-cf", teamArchiveFileName, ...files], {
            log: gi.progressLog,
            cwd: (project as LocalProject).baseDir,
        });
        await spawnLog("gzip", ["-3", teamArchiveFileName], {
            log: gi.progressLog,
            cwd: (project as LocalProject).baseDir,
        });
        await this.store.store(gi, classifier, teamArchiveFileName + ".gz");
    }

    public async remove(gi: GoalInvocation, classifier?: string): Promise<void> {
        await this.store.delete(gi, classifier);
    }

    public async retrieve(gi: GoalInvocation, project: Project, classifier?: string): Promise<void> {
        const archiveName = "atomistgoalcache";
        const teamArchiveFileName = path.join((project as LocalProject).baseDir, `${archiveName}.${guid().slice(0, 7)}`);
        await this.store.retrieve(gi, classifier, teamArchiveFileName);
        if (fs.existsSync(teamArchiveFileName)) {
            await spawnLog("tar", ["-xzf", teamArchiveFileName], {
                log: gi.progressLog,
                cwd: (project as LocalProject).baseDir,
            });
        } else {
            throw Error("No cache entry");
        }
    }
}
