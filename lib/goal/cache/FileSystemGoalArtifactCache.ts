import {
    logger,
    Project,
    RepoRef,
} from "@atomist/automation-client";
import { LocalProject } from "@atomist/automation-client/lib/project/local/LocalProject";
import { ProgressLog, spawnLog, StringCapturingProgressLog } from "@atomist/sdm";
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
