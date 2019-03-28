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
    InMemoryProject,
    Project,
    ProjectFile,
    RepoRef,
} from "@atomist/automation-client";
import {
    fakeGoalInvocation,
    fakePush,
    GoalProjectListenerEvent,
    LoggingProgressLog,
    ProgressLog,
} from "@atomist/sdm";
import { GoalProjectListener } from "@atomist/sdm/lib/api/goal/GoalInvocation";
import * as assert from "power-assert";
import {
    cacheGoalArtifacts,
    GoalCache,
    GoalCacheOptions,
    removeGoalArtifacts,
    restoreGoalArtifacts,
} from "../../../index";

describe("CacheArtifacts", () => {
        let project;
        const testCache = new TestGoalArtifactCache();
        let fakePushId;
        let fakeGoal;

        beforeEach(() => {
            project = InMemoryProject.of({path: "test.txt", content: "Test"});
            fakePushId = fakePush().id;
            fakeGoal = fakeGoalInvocation(fakePushId);
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache.enabled = true;
        });

        it("should cache and retrieve", async () => {
            const options: GoalCacheOptions = {
                globPatterns: [{classifier: "default", pattern: "**/*.txt"}],
                fallbackListenerOnCacheMiss: () => { throw Error("should not happen"); },
            };
            await cacheGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // it should find it in the cache
            const emptyProject = InMemoryProject.of();
            await restoreGoalArtifacts(options)
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test.txt"));
        });

        it("should call fallback on cache miss", async () => {
            // when cache something
            const fallback: GoalProjectListener = async p => {
                await p.addFile("test2.txt", "test");
            };
            const options: GoalCacheOptions = {
                globPatterns: [{classifier: "default", pattern: "**/*.txt"}],
                fallbackListenerOnCacheMiss: fallback,
            };
            await cacheGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // and clearing the cache
            await removeGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // it should not find it in the cache and call fallback
            const emptyProject = InMemoryProject.of();
            await restoreGoalArtifacts(options)
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test2.txt"));
        });
});

class TestGoalArtifactCache implements GoalCache {
    private id: RepoRef;
    private cacheFiles: ProjectFile[];
    private classifier: string;

    public async put(id: RepoRef, project: Project, files: string[], classifier: string = "default", log: ProgressLog): Promise<void> {
        this.id = id;
        this.cacheFiles = await Promise.all(files.map(async f => project.getFile(f)));
        this.classifier = classifier;
        return undefined;
    }

    public async empty(): Promise<void> {
        this.id = undefined;
        this.cacheFiles = undefined;
        this.classifier = undefined;
    }

    public async remove(id: RepoRef): Promise<void> {
        if (this.id === id) {
            this.id = undefined;
            this.cacheFiles = undefined;
            this.classifier = undefined;
        } else {
            throw Error("Wrong id!");
        }
    }

    public async retrieve(id: RepoRef, project: Project, log: ProgressLog, classifier: string = "default"): Promise<void> {
        if (this.id === id && this.classifier === classifier) {
            if (this.cacheFiles === undefined) {
                throw Error("No cache");
            }
            this.cacheFiles.forEach(f => project.add(f));
        } else {
            throw Error("Wrong id!");
        }
    }
}
