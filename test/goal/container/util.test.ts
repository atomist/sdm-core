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

import { guid } from "@atomist/automation-client";
import {
    SdmContext,
    SdmGoalEvent,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as assert from "power-assert";
import {
    ContainerInput,
    ContainerOutput,
    ContainerProjectHome,
    ContainerResult,
} from "../../../lib/goal/container/container";
import {
    containerEnvVars,
    copyProject,
} from "../../../lib/goal/container/util";

describe("goal/container/util", () => {

    describe("containerEnvVars", () => {

        it("should add k8s service to goal event data", async () => {
            const sge: SdmGoalEvent = {
                branch: "psychedelic-rock",
                goalSetId: "0abcdef-123456789-abcdef",
                repo: {
                    name: "odessey-and-oracle",
                    owner: "TheZombies",
                    providerId: "CBS",
                },
                sha: "7ee1af8ee2f80ad1e718dbb2028120b3a2984892",
                uniqueName: "BeechwoodPark.ts#L243",
            } as any;
            const c: SdmContext = {
                context: {
                    graphClient: {
                        query: async () => ({ SdmVersion: [{ version: "1968.4.19" }] }),
                    },
                },
                correlationId: "fedcba9876543210-0123456789abcdef-f9e8d7c6b5a43210",
                workspaceId: "AR05343M1LY",
            } as any;
            const ge = await containerEnvVars(sge, c);
            const e = [
                {
                    name: "ATOMIST_SLUG",
                    value: "TheZombies/odessey-and-oracle",
                },
                {
                    name: "ATOMIST_OWNER",
                    value: "TheZombies",
                },
                {
                    name: "ATOMIST_REPO",
                    value: "odessey-and-oracle",
                },
                {
                    name: "ATOMIST_SHA",
                    value: "7ee1af8ee2f80ad1e718dbb2028120b3a2984892",
                },
                {
                    name: "ATOMIST_BRANCH",
                    value: "psychedelic-rock",
                },
                {
                    name: "ATOMIST_VERSION",
                    value: "1968.4.19",
                },
                {
                    name: "ATOMIST_GOAL",
                    value: `${ContainerInput}/goal.json`,
                },
                {
                    name: "ATOMIST_SECRETS",
                    value: `${ContainerInput}/secrets.json`,
                },
                {
                    name: "ATOMIST_RESULT",
                    value: ContainerResult,
                },
                {
                    name: "ATOMIST_INPUT_DIR",
                    value: ContainerInput,
                },
                {
                    name: "ATOMIST_OUTPUT_DIR",
                    value: ContainerOutput,
                },
                {
                    name: "ATOMIST_PROJECT_DIR",
                    value: ContainerProjectHome,
                },
            ];
            assert.deepStrictEqual(ge, e);
        });

    });

    describe("copyProject", () => {

        const tmpDirPrefix = "atomist-sdm-core-container-util-test";
        const tmpDirs: string[] = [];
        after(async () => {
            await Promise.all(tmpDirs.map(t => fs.remove(t)));
        });

        it("should copy project from one location to another", async () => {
            const s = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
            const d = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
            tmpDirs.push(s, d);
            await fs.ensureDir(s);
            const sf = path.join(s, "FriendsOfMine.txt");
            await fs.writeFile(sf, "This Will Be Our Year\n");
            await copyProject(s, d);
            const df = path.join(d, "FriendsOfMine.txt");
            assert(fs.existsSync(df));
            const dfc = await fs.readFile(df, "utf8");
            assert(dfc === "This Will Be Our Year\n");
        });

        it("should copy nested and hidden files", async () => {
            const s = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
            const d = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
            tmpDirs.push(s, d);
            const n = path.join(s, "Time", "of", "the", "Season");
            await fs.ensureDir(n);
            const sf = path.join(s, "Time", ".FriendsOfMine.txt");
            await fs.writeFile(sf, "This Will Be Our Year\n");
            const sf1 = path.join(n, "Butcher's Tale.ts");
            await fs.writeFile(sf1, "// Western Front 1914\n");
            await copyProject(s, d);
            const df = path.join(d, "Time", ".FriendsOfMine.txt");
            assert(fs.existsSync(df));
            const dfc = await fs.readFile(df, "utf8");
            assert(dfc === "This Will Be Our Year\n");
            const df1 = path.join(d, "Time", "of", "the", "Season", "Butcher's Tale.ts");
            assert(fs.existsSync(df1));
            const dfc1 = await fs.readFile(df1, "utf8");
            assert(dfc1 === "// Western Front 1914\n");
        });

        it("should clean destination project", async () => {
            const s = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
            const d = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
            tmpDirs.push(s, d);
            await fs.ensureDir(s);
            await fs.ensureDir(d);
            const sf = path.join(s, "FriendsOfMine.txt");
            await fs.writeFile(sf, "This Will Be Our Year\n");
            const dx = path.join(d, "README.md");
            await fs.writeFile(dx, "# Hung Up on a Dream\n");
            assert(fs.existsSync(dx));
            await copyProject(s, d);
            const df = path.join(d, "FriendsOfMine.txt");
            assert(fs.existsSync(df));
            const dfc = await fs.readFile(df, "utf8");
            assert(dfc === "This Will Be Our Year\n");
            assert(!fs.existsSync(dx));
        });

    });

});
