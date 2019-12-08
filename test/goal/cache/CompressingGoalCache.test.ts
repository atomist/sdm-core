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
import * as rimraf from "rimraf";
import { promisify } from "util";
import {
    CompressingGoalCache,
    resolveClassifierPath,
    sanitizeClassifier,
} from "../../../lib/goal/cache/CompressingGoalCache";
import {
    cachePut,
    cacheRemove,
    cacheRestore,
    GoalCacheOptions,
} from "../../../lib/goal/cache/goalCaching";

describe("goal/cache/CompressingGoalCache", () => {

    describe("sanitizeClassifier", () => {

        it("should do nothing successfully", () => {
            ["", "simple", "foo.bar", "foo..bar"].forEach(c => {
                const s = sanitizeClassifier(c);
                assert(s === c);
            });
        });

        it("should unhide paths", () => {
            [
                { c: ".foo", e: "foo" },
                { c: "..foo", e: "foo" },
                { c: "._foo", e: "_foo" },
                { c: "./.", e: "_." },
                { c: "././.", e: "_._." },
                { c: "./.././", e: "_.._._" },
                { c: "..", e: "" },
                { c: "../../..", e: "_.._.." },
                { c: "../../../", e: "_.._.._" },
                { c: "../../../foo", e: "_.._.._foo" },
            ].forEach(ce => {
                const s = sanitizeClassifier(ce.c);
                assert(s === ce.e);
                const b = ce.c.replace(/\//g, "\\");
                const t = sanitizeClassifier(b);
                assert(t === ce.e);
            });
        });

        it("should replace invalid characters", () => {
            [
                { c: "/", e: "_" },
                { c: "///", e: "___" },
                { c: "/foo", e: "_foo" },
                { c: "///foo", e: "___foo" },
                { c: "//foo//", e: "__foo__" },
                { c: "/../../../foo", e: "_.._.._.._foo" },
                { c: "_foo", e: "_foo" },
                { c: "__foo", e: "__foo" },
                { c: "foo.", e: "foo." },
                { c: "foo..", e: "foo.." },
                { c: "foo/", e: "foo_" },
                { c: "foo////", e: "foo____" },
                { c: "foo/..", e: "foo_.." },
                { c: "foo/.././..", e: "foo_.._._.." },
                { c: "foo/././././", e: "foo_._._._._" },
                { c: "foo/../../../..", e: "foo_.._.._.._.." },
                { c: "foo/../../../../", e: "foo_.._.._.._.._" },
                { c: "foo/./bar", e: "foo_._bar" },
                { c: "foo/././bar", e: "foo_._._bar" },
                { c: "foo/././././bar", e: "foo_._._._._bar" },
                { c: "foo/../bar", e: "foo_.._bar" },
                { c: "foo/../../bar", e: "foo_.._.._bar" },
                { c: "foo/../../../../bar", e: "foo_.._.._.._.._bar" },
                { c: "foo/./.././../bar", e: "foo_._.._._.._bar" },
                { c: "foo/.././.././bar", e: "foo_.._._.._._bar" },
                { c: "foo/..///.//../bar", e: "foo_..___.__.._bar" },
                { c: "foo/.././/.././bar/../././//..//./baz", e: "foo_.._.__.._._bar_.._._.___..__._baz" },
                { c: "foo/.../bar", e: "foo_..._bar" },
                { c: "foo/..../bar", e: "foo_...._bar" },
                { c: "foo/.bar", e: "foo_.bar" },
                { c: "foo/..bar", e: "foo_..bar" },
                { c: "foo/...bar", e: "foo_...bar" },
                { c: "foo/.bar/.baz", e: "foo_.bar_.baz" },
                { c: "foo/..bar/..baz", e: "foo_..bar_..baz" },
                { c: "foo/.../bar/.../baz", e: "foo_..._bar_..._baz" },
                { c: "foo/....bar.baz", e: "foo_....bar.baz" },
                { c: "foo/.../.bar.baz", e: "foo_..._.bar.baz" },
                { c: "foo/....bar.baz/.qux.", e: "foo_....bar.baz_.qux." },
            ].forEach(ce => {
                const s = sanitizeClassifier(ce.c);
                assert(s === ce.e);
                const b = ce.c.replace(/\//g, "\\");
                const t = sanitizeClassifier(b);
                assert(t === ce.e);
            });
        });

        it("should handle the diabolical", () => {
            const c = "../.././...////....foo//.bar.baz/./..//...///...qux./quux...quuz/./../corge//...///./.";
            const s = sanitizeClassifier(c);
            const e = "_.._._...____....foo__.bar.baz_._..__...___...qux._quux...quuz_._.._corge__...___._.";
            assert(s === e);
        });

    });

    describe("resolveClassifierPath", () => {

        const gi: any = {
            configuration: {
                sdm: {
                    docker: {
                        registry: "kinks/bigsky",
                    },
                },
            },
            context: {
                workspaceId: "TH3K1NK5",
            },
            goalEvent: {
                branch: "preservation/society",
                repo: {
                    name: "village-green",
                    owner: "TheKinks",
                    providerId: "PyeReprise",
                },
                sha: "9932791f7adfd854b576125b058e9eb45b3da8b9",
            },
        };

        it("should return the workspace ID", async () => {
            for (const c of [undefined, ""]) {
                const r = await resolveClassifierPath(c, gi);
                assert(r === "TH3K1NK5");
            }
        });

        it("should prepend the workspace ID", async () => {
            for (const c of ["simple", "foo.bar", "foo..bar"]) {
                const r = await resolveClassifierPath(c, gi);
                assert(r === `TH3K1NK5/${c}`);
            }
        });

        it("should replace placeholders", async () => {
            // tslint:disable-next-line:no-invalid-template-strings
            const c = "star-struck_${repo.providerId}_${repo.owner}_${repo.name}_${sha}_PhenomenalCat";
            const r = await resolveClassifierPath(c, gi);
            const e = "TH3K1NK5/star-struck_PyeReprise_TheKinks_village-green_9932791f7adfd854b576125b058e9eb45b3da8b9_PhenomenalCat";
            assert(r === e);
        });

        it("should replace placeholders and provide defaults", async () => {
            // tslint:disable-next-line:no-invalid-template-strings
            const c = "star-struck_${repo.providerId}_${repo.owner}_${repo.name}_${brunch:hunch}_PhenomenalCat";
            const r = await resolveClassifierPath(c, gi);
            const e = "TH3K1NK5/star-struck_PyeReprise_TheKinks_village-green_hunch_PhenomenalCat";
            assert(r === e);
        });

        it("should replace nested placeholders", async () => {
            // tslint:disable-next-line:no-invalid-template-strings
            const c = "star-struck_${repo.providerId}_${repo.owner}_${repo.name}_${brunch:${sha}}_PhenomenalCat";
            const r = await resolveClassifierPath(c, gi);
            const e = "TH3K1NK5/star-struck_PyeReprise_TheKinks_village-green_9932791f7adfd854b576125b058e9eb45b3da8b9_PhenomenalCat";
            assert(r === e);
        });

        it("should replace and sanitize placeholders", async () => {
            // tslint:disable-next-line:no-invalid-template-strings
            const c = "star-struck_${sdm.docker.registry}_${repo.owner}_${repo.name}_${branch}_PhenomenalCat";
            const r = await resolveClassifierPath(c, gi);
            const e = "TH3K1NK5/star-struck_kinks_bigsky_TheKinks_village-green_preservation_society_PhenomenalCat";
            assert(r === e);
        });

    });

    describe("CompressingGoalCache", () => {

        const testDirPrefix = path.join(os.tmpdir(), "sdm-core-test-");

        function testDir(): string {
            return testDirPrefix + guid();
        }

        async function createTempProject(fakePushId: RepoRef): Promise<LocalProject> {
            const projectDir = testDir();
            await fs.ensureDir(projectDir);
            return NodeFsLocalProject.fromExistingDirectory(fakePushId, projectDir);
        }

        const ErrorProjectListenerRegistration: GoalProjectListenerRegistration = {
            name: "Error",
            listener: async () => { throw Error("Cache miss"); },
            pushTest: AnyPush,
        };

        const rm = promisify(rimraf);
        after(async () => {
            try {
                await rm(testDirPrefix + "*");
            } catch (e) {
                // ignore error
            }
        });

        it("should cache and retrieve", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir(), store: testCache };

            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } }],
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

        it("should cache and retrieve, excluding specific directories", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir() };

            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { globPattern: ["**/*.txt", "!excludeme/**/*"] } }],
                onCacheMiss: ErrorProjectListenerRegistration,
            };
            // when cache something
            const project = await createTempProject(fakePushId);
            await project.addFile("test.txt", "test");
            await project.addFile("excludeme/test.txt", "test");
            await cachePut(options)
                .listener(project as any as GitProject, fakeGoal, GoalProjectListenerEvent.after);
            // it should find it in the cache
            const emptyProject = await createTempProject(fakePushId);
            await cacheRestore(options)
                .listener(emptyProject as any as GitProject, fakeGoal, GoalProjectListenerEvent.before);
            assert(await emptyProject.hasFile("test.txt"));
            assert(!await emptyProject.hasFile("excludeme/test.txt"));
        });

        it("should cache and retrieve complete directories", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir() };

            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { directory: "test" } }],
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
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir() };

            const fallback: GoalProjectListenerRegistration = {
                name: "fallback",
                listener: async p => {
                    await p.addFile("test2.txt", "test");
                },
            };
            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } }],
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

        it("should create different archives", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir() };

            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } },
                { classifier: "batches", pattern: { globPattern: "**/*.bat" } }],
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

        it("should create different archives and restore all", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir() };

            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } },
                { classifier: "batches", pattern: { globPattern: "**/*.bat" } }],
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

        it("should create different archives and be able to select one", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir() };

            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } },
                { classifier: "batches", pattern: { globPattern: "**/*.bat" } }],
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

        it("should create specific archives and fallback", async () => {
            const fakePushId = fakePush().id;
            fakePushId.sha = "testing";
            const fakeGoal = fakeGoalInvocation(fakePushId);
            const testCache = new CompressingGoalCache();
            fakeGoal.progressLog = new LoggingProgressLog("test", "debug");
            fakeGoal.configuration.sdm.goalCache = testCache;
            fakeGoal.configuration.sdm.cache = { enabled: true, path: testDir() };

            const fallback: GoalProjectListenerRegistration = {
                name: "fallback",
                listener: async p => {
                    await p.addFile("fallback.text", "test");
                },
            };
            const options: GoalCacheOptions = {
                entries: [{ classifier: "default", pattern: { globPattern: "**/*.txt" } }, {
                    classifier: "batches",
                    pattern: { globPattern: "**/*.bat" },
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

});
