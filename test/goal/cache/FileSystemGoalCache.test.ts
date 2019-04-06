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
    guid,
    LocalProject,
    NodeFsLocalProject,
    RepoRef,
} from "@atomist/automation-client";
import {
    AnyPush,
    fakeGoalInvocation,
    fakePush,
    GoalProjectListenerEvent,
    GoalProjectListenerRegistration,
    LoggingProgressLog,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as assert from "power-assert";
import {
    cachePut,
    cacheRemove,
    cacheRestore,
    FileSystemGoalCache,
    GoalCacheOptions,
} from "../../../index";

async function createTempProject(fakePushId: RepoRef): Promise<LocalProject> {
    const projectDir = (path.join(os.tmpdir(), guid()));
    fs.mkdirSync(projectDir);
    return NodeFsLocalProject.fromExistingDirectory(fakePushId, projectDir);
}

const ErrorProjectListenerRegistration: GoalProjectListenerRegistration = {
    name: "Error",
    listener: async () => { throw Error(""); },
    pushTest: AnyPush,
};

describe("FileSystemGoalCache", () => {

    it("should cache and retrieve", async () => {
        const fakePushId = fakePush().id;
        fakePushId.sha = "testing";
        const fakeGoal = fakeGoalInvocation(fakePushId);
        const testCache = new FileSystemGoalCache(path.join(os.tmpdir(), guid()));
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = { enabled: true };

        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" }}],
            onCacheMiss: ErrorProjectListenerRegistration,
        };
        // when cache something
        const project = await createTempProject(fakePushId);
        await project.addFile("test.txt", "test");
        await cachePut(options)
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        // it should find it in the cache
        const emptyProject = await createTempProject(fakePushId);
        await cacheRestore(options)
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test.txt"));
    });

    it("should cache and retrieve complete directories", async () => {
        const fakePushId = fakePush().id;
        fakePushId.sha = "testing";
        const fakeGoal = fakeGoalInvocation(fakePushId);
        const testCache = new FileSystemGoalCache(path.join(os.tmpdir(), guid()));
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = { enabled: true };

        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: { directory: "test" }}],
            onCacheMiss: ErrorProjectListenerRegistration,
        };
        // when cache something
        const project = await createTempProject(fakePushId);
        await project.addFile("test/test.txt", "test");
        await project.addFile("test/test2.txt", "test");
        await cachePut(options)
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        // it should find it in the cache
        const emptyProject = await createTempProject(fakePushId);
        await cacheRestore(options)
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test/test.txt"));
        assert(await emptyProject.hasFile("test/test2.txt"));
    });

    it("should call fallback on cache miss", async () => {
        const fakePushId = fakePush().id;
        fakePushId.sha = "testing";
        const fakeGoal = fakeGoalInvocation(fakePushId);
        const testCache = new FileSystemGoalCache(path.join(os.tmpdir(), guid()));
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = { enabled: true };

        const fallback: GoalProjectListenerRegistration = { name: "fallback", listener: async p => {
            await p.addFile("test2.txt", "test");
        }};
        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" }}],
            onCacheMiss: [fallback],
        };
        // when cache something
        const project = await createTempProject(fakePushId);
        await project.addFile("test.txt", "test");
        await cachePut(options)
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        // and clearing the cache
        await cacheRemove(options)
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        // it should not find it in the cache and call fallback
        const emptyProject = await createTempProject(fakePushId);
        await cacheRestore(options)
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test2.txt"));
    });

    it("should call create different archives", async () => {
        const fakePushId = fakePush().id;
        fakePushId.sha = "testing";
        const fakeGoal = fakeGoalInvocation(fakePushId);
        const testCache = new FileSystemGoalCache(path.join(os.tmpdir(), guid()));
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = { enabled: true };

        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } },
                { classifier: "batches", pattern: { globPattern: "**/*.bat" }}],
            onCacheMiss: ErrorProjectListenerRegistration,
        };
        // when cache something
        const project = await createTempProject(fakePushId);
        await project.addFile("test.txt", "test");
        await project.addFile("test.bat", "test");
        await cachePut(options)
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        const emptyProject = await createTempProject(fakePushId);
        await cacheRestore(options, "default", "batches")
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test.txt"));
        assert(await emptyProject.hasFile("test.bat"));
    });

    it("should call create different archives and restore all", async () => {
        const fakePushId = fakePush().id;
        fakePushId.sha = "testing";
        const fakeGoal = fakeGoalInvocation(fakePushId);
        const testCache = new FileSystemGoalCache(path.join(os.tmpdir(), guid()));
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = { enabled: true };

        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } },
                { classifier: "batches", pattern: { globPattern: "**/*.bat" }}],
            onCacheMiss: ErrorProjectListenerRegistration,
        };
        // when cache something
        const project = await createTempProject(fakePushId);
        await project.addFile("test.txt", "test");
        await project.addFile("test.bat", "test");
        await cachePut(options)
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        const emptyProject = await createTempProject(fakePushId);
        await cacheRestore(options)
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(await emptyProject.hasFile("test.txt"));
        assert(await emptyProject.hasFile("test.bat"));
    });

    it("should call create different archives and be able to select one", async () => {
        const fakePushId = fakePush().id;
        fakePushId.sha = "testing";
        const fakeGoal = fakeGoalInvocation(fakePushId);
        const testCache = new FileSystemGoalCache(path.join(os.tmpdir(), guid()));
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = { enabled: true };

        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" }},
                {classifier: "batches", pattern: { globPattern: "**/*.bat"}}],
            onCacheMiss: ErrorProjectListenerRegistration,
        };
        // when cache something
        const project = await createTempProject(fakePushId);
        await project.addFile("test.txt", "test");
        await project.addFile("test.bat", "test");
        await cachePut(options)
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        const emptyProject = await createTempProject(fakePushId);
        await cacheRestore(options, "batches")
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(!await emptyProject.hasFile("test.txt"));
        assert(await emptyProject.hasFile("test.bat"));
    });

    it("should call create specific archives and fallback", async () => {
        const fakePushId = fakePush().id;
        fakePushId.sha = "testing";
        const fakeGoal = fakeGoalInvocation(fakePushId);
        const testCache = new FileSystemGoalCache(path.join(os.tmpdir(), guid()));
        fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
        fakeGoal.configuration.sdm.goalCache = testCache;
        fakeGoal.configuration.sdm.cache = { enabled: true };

        const fallback: GoalProjectListenerRegistration = { name: "fallback", listener: async p => {
                await p.addFile("fallback.text", "test");
            }};
        const options: GoalCacheOptions = {
            entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } }, {
                classifier: "batches",
                pattern: { globPattern: "**/*.bat"},
            }],
            onCacheMiss: [fallback],
        };
        // when cache something
        const project = await createTempProject(fakePushId);
        await project.addFile("test.txt", "test");
        await project.addFile("test.bat", "test");
        await cachePut(options, "batches")
            .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
        const emptyProject = await createTempProject(fakePushId);
        await cacheRestore(options, "default")
            .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
        assert(!await emptyProject.hasFile("test.txt"));
        assert(!await emptyProject.hasFile("test.bat"));
        assert(await emptyProject.hasFile("fallback.text"));
    });
});
