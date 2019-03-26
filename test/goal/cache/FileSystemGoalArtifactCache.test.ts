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
    GitProject, LocalProject,
    NodeFsLocalProject,
} from "@atomist/automation-client";
import {
    fakeGoalInvocation,
    fakePush,
    GoalProjectListenerEvent, LoggingProgressLog,
    pushTest,
    PushTest,
} from "@atomist/sdm";
import { GoalProjectListener } from "@atomist/sdm/lib/api/goal/GoalInvocation";
import * as fs from "fs-extra";
import * as path from "path";
import * as assert from "power-assert";
import { tempdir } from "shelljs";
import uuid = require("uuid");
import {
    cacheGoalArtifacts, FileSystemGoalArtifactCache,
    removeGoalArtifacts,
    restoreGoalArtifacts,
} from "../../../index";

async function createTempProject(fakePushId) {
    const projectDir = (path.join(tempdir(), uuid()));
    fs.mkdirSync(projectDir);
    return await NodeFsLocalProject.fromExistingDirectory(fakePushId, projectDir);
}

describe("FileSystemGoalArtifactCache", () => {
        it("should cache and retrieve", async () => {
            const fakePushId = fakePush().id;
            const fakeGoal = fakeGoalInvocation(fakePushId);
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            const testCache = new FileSystemGoalArtifactCache(path.join(tempdir(), uuid()));
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await cacheGoalArtifacts(testCache, {globPattern: "**/*.txt"})
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // it should find it in the cache
            const emptyProject = await createTempProject(fakePushId);
            await restoreGoalArtifacts(testCache, {})
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test.txt"));
        });

        it("should call fallback on cache miss", async () => {
            const fakePushId = fakePush().id;
            const fakeGoal = fakeGoalInvocation(fakePushId);
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            const testCache = new FileSystemGoalArtifactCache(path.join(tempdir(), uuid()));
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await cacheGoalArtifacts(testCache, {globPattern: "**/*.txt"})
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // and clearing the cache
            await removeGoalArtifacts(testCache, {globPattern: "**/*.txt"})
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // it should not find it in the cache and call fallback
            const emptyProject = await createTempProject(fakePushId);
            const fallback: GoalProjectListener = async p => {
                await p.addFile("test2.txt", "test");
            };
            await restoreGoalArtifacts(testCache, {fallbackListenerOnCacheMiss: fallback})
                .listener(emptyProject as any as GitProject, fakeGoalInvocation(fakePushId), GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test2.txt"));
        });

        it("should check push test", async () => {
            const neverCache: PushTest = pushTest("test", async () => false);
            const fakePushId = fakePush().id;
            const testCache = new FileSystemGoalArtifactCache(path.join(tempdir(), uuid()));
            const fakeGoal = fakeGoalInvocation(fakePushId);
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await cacheGoalArtifacts(testCache, {globPattern: "**/*.txt", pushTest: neverCache})
                .listener(project as any as GitProject, fakeGoal,  GoalProjectListenerEvent.after);
            // it should not find it in the cache and call fallback
            const emptyProject = await createTempProject(fakePushId);
            await restoreGoalArtifacts(testCache, {pushTest: neverCache})
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(!(await emptyProject.hasFile("test.txt")));
        });
});
