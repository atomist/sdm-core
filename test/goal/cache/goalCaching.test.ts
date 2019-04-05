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
    GoalInvocation,
    GoalProjectListener,
    GoalProjectListenerEvent,
    LoggingProgressLog,
} from "@atomist/sdm";
import * as assert from "power-assert";
import {
    cachePut,
    cacheRemove,
    cacheRestore,
    GoalCache,
    GoalCacheOptions,
} from "../../../index";

class TestGoalArtifactCache implements GoalCache {
    private id: RepoRef;
    private cacheFiles: ProjectFile[];
    private classifier: string;

    public async put(gi: GoalInvocation, project: Project, files: string[], classifier: string = "default"): Promise<void> {
        this.id = gi.id;
        this.cacheFiles = await Promise.all(files.map(async f => project.getFile(f)));
        this.classifier = classifier;
        return undefined;
    }

    public async empty(): Promise<void> {
        this.id = undefined;
        this.cacheFiles = undefined;
        this.classifier = undefined;
    }

    public async remove(gi: GoalInvocation): Promise<void> {
        if (this.id === gi.id) {
            this.id = undefined;
            this.cacheFiles = undefined;
            this.classifier = undefined;
        } else {
            throw Error("Wrong id!");
        }
    }

    public async retrieve(gi: GoalInvocation, project: Project, classifier: string = "default"): Promise<void> {
        if (this.id === gi.id && this.classifier === classifier) {
            if (this.cacheFiles === undefined) {
                throw Error("No cache");
            }
            this.cacheFiles.forEach(f => project.add(f));
        } else {
            throw Error("Wrong id!");
        }
    }
}

describe("goalCaching", () => {
    let project;
    const testCache = new TestGoalArtifactCache();
    let fakePushId;
    let fakeGoal;

    beforeEach(() => {
        project = InMemoryProject.of({ path: "test.txt", content: "Test" });
        fakePushId = fakePush().id;
        fakeGoal = fakeGoalInvocation(fakePushId);
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = {
            enabled: true,
        };
    });

    it("should cache and retrieve", async () => {
        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: "**/*.txt" }],
            onCacheMiss: [() => {
                throw Error("should not happen");
            }],
        };
        await cachePut(options)
            .listener(project, fakeGoal, GoalProjectListenerEvent.after);
        // it should find it in the cache
        const emptyProject = InMemoryProject.of();
        await cacheRestore(options)
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test.txt"));
    });

    it("should call fallback on cache miss", async () => {
        // when cache something
        const fallback: GoalProjectListener = async p => {
            await p.addFile("test2.txt", "test");
        };
        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: "**/*.txt" }],
            onCacheMiss: [fallback],
        };
        await cachePut(options)
            .listener(project, fakeGoal, GoalProjectListenerEvent.after);
        // and clearing the cache
        await cacheRemove(options)
            .listener(project, fakeGoal, GoalProjectListenerEvent.after);
        // it should not find it in the cache and call fallback
        const emptyProject = InMemoryProject.of();
        await cacheRestore(options)
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test2.txt"));
    });

    it("should call multiple fallbacks on cache miss", async () => {
        // when cache something
        const fallback: GoalProjectListener = async p => {
            await p.addFile("test2.txt", "test");
        };
        const fallback2: GoalProjectListener = async p => {
            if (await p.hasFile("test2.txt")) {
                await p.addFile("test3.txt", "test");
            }
        };
        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: "**/*.txt" }],
            onCacheMiss: [fallback, fallback2],
        };
        await cachePut(options)
            .listener(project, fakeGoal, GoalProjectListenerEvent.after);
        // and clearing the cache
        await cacheRemove(options)
            .listener(project, fakeGoal, GoalProjectListenerEvent.after);
        // it should not find it in the cache and call fallback
        const emptyProject = InMemoryProject.of();
        await cacheRestore(options)
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test2.txt"));
        assert(await emptyProject.hasFile("test3.txt"));
    });
});
