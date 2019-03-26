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
    ProgressLog,
    pushTest,
    PushTest,
} from "@atomist/sdm";
import { GoalProjectListener } from "@atomist/sdm/lib/api/goal/GoalInvocation";
import * as assert from "power-assert";
import {
    cacheGoalArtifacts,
    GoalArtifactCache,
    removeGoalArtifacts,
    restoreGoalArtifacts,
} from "../../../index";

describe("CacheArtifacts", () => {

        class TestGoalArtifactCache implements GoalArtifactCache {
            private id: RepoRef;
            private cacheFiles: ProjectFile[];

            public async putInCache(id: RepoRef, project: Project, files: string[], log: ProgressLog): Promise<void> {
                this.id = id;
                this.cacheFiles = await Promise.all(files.map(async f => project.getFile(f)));
                return undefined;
            }

            public async empty(): Promise<void> {
                this.id = undefined;
                this.cacheFiles = undefined;
            }

            public async removeFromCache(id: RepoRef): Promise<void> {
                if (this.id === id) {
                    this.id = undefined;
                    this.cacheFiles = undefined;
                } else {
                    throw Error("Wrong id!");
                }
            }

            public async retrieveFromCache(id: RepoRef, project: Project, log: ProgressLog): Promise<void> {
                if (this.id === id) {
                    if (this.cacheFiles === undefined) {
                        throw Error("No cache");
                    }
                    this.cacheFiles.forEach(f => project.add(f));
                } else {
                    throw Error("Wrong id!");
                }
            }
        }

        it("should cache and retrieve", async () => {
            // when cache something
            const project = InMemoryProject.of({path: "test.txt", content: "Test"});
            const testCache = new TestGoalArtifactCache();
            const fakePushId = fakePush().id;
            await cacheGoalArtifacts(testCache, {globPattern: "**/*.txt"})
                .listener(project as any as GitProject, fakeGoalInvocation(fakePushId) ,  GoalProjectListenerEvent.after);
            // it should find it in the cache
            const emptyProject = InMemoryProject.of();
            await restoreGoalArtifacts(testCache, {})
                .listener(emptyProject as any as GitProject, fakeGoalInvocation(fakePushId), GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test.txt"));
        });

        it("should call fallback on cache miss", async () => {
            // when cache something
            const project = InMemoryProject.of({path: "test.txt", content: "Test"});
            const testCache = new TestGoalArtifactCache();
            const fakePushId = fakePush().id;
            await cacheGoalArtifacts(testCache, {globPattern: "**/*.txt"})
                .listener(project as any as GitProject, fakeGoalInvocation(fakePushId),  GoalProjectListenerEvent.after);
            // and clearing the cache
            await removeGoalArtifacts(testCache, {globPattern: "**/*.txt"})
                .listener(project as any as GitProject, fakeGoalInvocation(fakePushId),  GoalProjectListenerEvent.after);
            // it should not find it in the cache and call fallback
            const emptyProject = InMemoryProject.of();
            const fallback: GoalProjectListener = async p => {
                await p.addFile("test2.txt", "test");
            };
            await restoreGoalArtifacts(testCache, {fallbackListenerOnCacheMiss: fallback})
                .listener(emptyProject as any as GitProject, fakeGoalInvocation(fakePushId), GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test2.txt"));
        });

        it("should check push test", async () => {
            // when cache something with a specific pushtest that negates caching
            const neverCache: PushTest = pushTest("test", async p => false);
            const project = InMemoryProject.of({path: "test.txt", content: "Test"});
            const testCache = new TestGoalArtifactCache();
            const fakePushId = fakePush().id;
            await cacheGoalArtifacts(testCache, {globPattern: "**/*.txt", pushTest: neverCache})
                .listener(project as any as GitProject, fakeGoalInvocation(fakePushId),  GoalProjectListenerEvent.after);
            // it should not find it in the cache and call fallback
            const emptyProject = InMemoryProject.of();
            await restoreGoalArtifacts(testCache, {pushTest: neverCache})
                .listener(emptyProject as any as GitProject, fakeGoalInvocation(fakePushId), GoalProjectListenerEvent.before);
            assert(!(await emptyProject.hasFile("test.txt")));
        });
});
