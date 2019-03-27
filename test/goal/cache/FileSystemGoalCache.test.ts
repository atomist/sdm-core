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
    automationClientInstance,
    configurationValue,
    GitProject,
    LocalProject,
    NodeFsLocalProject,
    RepoRef,
} from "@atomist/automation-client";
import {
    fakeGoalInvocation,
    fakePush,
    GoalProjectListener,
    GoalProjectListenerEvent,
    LoggingProgressLog,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as path from "path";
import * as assert from "power-assert";
import { tempdir } from "shelljs";
import uuid = require("uuid");
import {
    cacheGoalArtifacts,
    FileSystemGoalCache,
    GoalCacheOptions,
    removeGoalArtifacts,
    restoreGoalArtifacts,
} from "../../../index";

async function createTempProject(fakePushId: RepoRef): Promise<LocalProject> {
    const projectDir = (path.join(tempdir(), uuid()));
    fs.mkdirSync(projectDir);
    return NodeFsLocalProject.fromExistingDirectory(fakePushId, projectDir);
}

describe("FileSystemGoalCache", () => {
        it("should cache and retrieve", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new FileSystemGoalCache(path.join(tempdir(), uuid()));
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true };

            const options: GoalCacheOptions = {
                globPatterns: [{classifier: "default", pattern: "**/*.txt"}],
            };
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await cacheGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // it should find it in the cache
            const emptyProject = await createTempProject(fakePushId);
            await restoreGoalArtifacts(options)
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test.txt"));
        });

        it("should call fallback on cache miss", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new FileSystemGoalCache(path.join(tempdir(), uuid()));
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true };

            const fallback: GoalProjectListener = async p => {
                await p.addFile("test2.txt", "test");
            };
            const options: GoalCacheOptions = {
                globPatterns: [{classifier: "default", pattern: "**/*.txt"}],
                fallbackListenerOnCacheMiss: fallback,
            };
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await cacheGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // and clearing the cache
            await removeGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // it should not find it in the cache and call fallback
            const emptyProject = await createTempProject(fakePushId);
            await restoreGoalArtifacts(options)
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test2.txt"));
        });

        it("should call create different archives", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new FileSystemGoalCache(path.join(tempdir(), uuid()));
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true };

            const options: GoalCacheOptions = {
                globPatterns: [{classifier: "default", pattern: "**/*.txt"}, {classifier: "batches", pattern: "**/*.bat"}],
            };
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await project.addFile("test.bat", "test");
            await cacheGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            const emptyProject = await createTempProject(fakePushId);
            await restoreGoalArtifacts(options)
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test.txt"));
            assert(await emptyProject.hasFile("test.bat"));
        });

        it("should call create different archives and be able to select one", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new FileSystemGoalCache(path.join(tempdir(), uuid()));
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true };

            const options: GoalCacheOptions = {
                globPatterns: [{classifier: "default", pattern: "**/*.txt"}, {classifier: "batches", pattern: "**/*.bat"}],
            };
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await project.addFile("test.bat", "test");
            await cacheGoalArtifacts(options)
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            const emptyProject = await createTempProject(fakePushId);
            await restoreGoalArtifacts(options, "batches")
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(!await emptyProject.hasFile("test.txt"));
            assert(await emptyProject.hasFile("test.bat"));
        });

        it("should call create specific archives and fallback", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new FileSystemGoalCache(path.join(tempdir(), uuid()));
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true };

            const fallback: GoalProjectListener = async p => {
                await p.addFile("fallback.text", "test");
            };
            const options: GoalCacheOptions = {
                globPatterns: [{classifier: "default", pattern: "**/*.txt"}, {classifier: "batches", pattern: "**/*.bat"}],
                fallbackListenerOnCacheMiss: fallback,
            };
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await project.addFile("test.bat", "test");
            await cacheGoalArtifacts(options, "batches")
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            const emptyProject = await createTempProject(fakePushId);
            await restoreGoalArtifacts(options, "default")
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(!await emptyProject.hasFile("test.txt"));
            assert(!await emptyProject.hasFile("test.bat"));
            assert(await emptyProject.hasFile("fallback.text"));
        });
});
