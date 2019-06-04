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
} from "@atomist/automation-client";
import {
    execPromise,
    ExecuteGoalResult,
    GoalInvocation,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as assert from "power-assert";
import { Container } from "../../../lib/goal/container/container";
import {
    containerDockerOptions,
    executeDockerJob,
} from "../../../lib/goal/container/docker";

describe("goal/container/docker", () => {

    describe("containerDockerOptions", () => {

        it("should return an empty array", () => {
            const c = {
                image: "townes/tecumseh-valley:4.55",
                name: "townes",
            };
            const r = {
                containers: [c],
            };
            const o = containerDockerOptions(c, r);
            const e = [];
            assert.deepStrictEqual(o, e);
        });

        it("should handle command as entrypoint", () => {
            const c = {
                image: "townes/tecumseh-valley:4.55",
                name: "townes",
                command: ["daughter", "of", "a", "miner"],
            };
            const r = {
                containers: [c],
            };
            const o = containerDockerOptions(c, r);
            const e = ["--entrypoint=daughter of a miner"];
            assert.deepStrictEqual(o, e);
        });

        it("should handle env", () => {
            const c = {
                image: "townes/tecumseh-valley:4.55",
                name: "townes",
                env: [
                    {
                        name: "DAUGHTER",
                        value: "miner",
                    },
                    {
                        name: "DAYS",
                        value: "free",
                    },
                    {
                        name: "SUNSHINE",
                        value: "walked beside her",
                    },
                ],
            };
            const r = {
                containers: [c],
            };
            const o = containerDockerOptions(c, r);
            const e = ["--env=DAUGHTER=miner", "--env=DAYS=free", "--env=SUNSHINE=walked beside her"];
            assert.deepStrictEqual(o, e);
        });

        it("should handle ports", () => {
            const c = {
                image: "townes/tecumseh-valley:4.55",
                name: "townes",
                ports: [
                    {
                        containerPort: 1238,
                    },
                    {
                        containerPort: 2247,
                    },
                    {
                        containerPort: 4304,
                    },
                ],
            };
            const r = {
                containers: [c],
            };
            const o = containerDockerOptions(c, r);
            const e = ["-p=1238", "-p=2247", "-p=4304"];
            assert.deepStrictEqual(o, e);
        });

        it("should handle volumes", () => {
            const c = {
                image: "townes/tecumseh-valley:4.55",
                name: "townes",
                volumeMounts: [
                    {
                        mountPath: "/like/a/summer/thursday",
                        name: "Thursday",
                    },
                    {
                        mountPath: "/our/mother/the/mountain",
                        name: "mountain",
                    },
                ],
            };
            const r = {
                containers: [c],
                volumes: [
                    {
                        hostPath: {
                            path: "/home/mountain",
                        },
                        name: "mountain",
                    },
                    {
                        hostPath: {
                            path: "/mnt/thursday",
                        },
                        name: "Thursday",
                    },
                ],
            };
            const o = containerDockerOptions(c, r);
            const e = ["--volume=/mnt/thursday:/like/a/summer/thursday", "--volume=/home/mountain:/our/mother/the/mountain"];
            assert.deepStrictEqual(o, e);
        });

    });

    describe("executeDockerJob", () => {

        before(async function(): Promise<void> {
            // tslint:disable-next-line:no-invalid-this
            this.timeout(20000);
            if (!fs.existsSync("/var/run/docker.sock") && !process.env.DOCKER_HOST) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            try {
                await execPromise("docker", ["pull", "alpine:latest"]);
            } catch (e) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
        });

        const g = new Container();
        const p: GitProject = InMemoryProject.of() as any;
        const gi: GoalInvocation = {
            context: {
                graphClient: {
                    query: () => ({ SdmVersion: [{ version: "3.1.3-20200220200220" }] }),
                },
            },
            configuration: {
                sdm: {
                    projectLoader: {
                        doWithProject: (o, a) => a(p),
                    },
                },
            },
            credentials: {},
            goalEvent: {
                branch: "high-low-and-inbetween",
                goalSetId: "27c20de4-2c88-480a-b4e7-f6c6d5a1d623",
                repo: {
                    name: "no-deal",
                    owner: "townes",
                    providerId: "album",
                },
                sha: "abcdef0123456789",
                uniqueName: g.definition.uniqueName,
            },
            id: {},
            progressLog: {
                write: () => { },
            },
        } as any;

        it("should run a docker container", async () => {
            const r = {
                containers: [
                    {
                        args: ["true"],
                        image: "alpine:latest",
                        name: "alpine",
                    },
                ],
            };
            const e = executeDockerJob(g, r);
            const egr = await e(gi);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
        }).timeout(10000);

        it("should report when the container fails", async () => {
            const r = {
                containers: [
                    {
                        args: ["false"],
                        image: "alpine:latest",
                        name: "alpine",
                    },
                ],
            };
            const e = executeDockerJob(g, r);
            const egr = await e(gi);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 1);
            assert(x.message.startsWith("Docker container 'sdm-alpine-27c20de-container' failed"));
        }).timeout(10000);

        it("should run multiple containers", async () => {
            const r = {
                containers: [
                    {
                        args: ["true"],
                        image: "alpine:latest",
                        name: "alpine0",
                    },
                    {
                        args: ["true"],
                        image: "alpine:latest",
                        name: "alpine1",
                    },
                    {
                        args: ["true"],
                        image: "alpine:latest",
                        name: "alpine2",
                    },
                ],
            };
            const e = executeDockerJob(g, r);
            const egr = await e(gi);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
        }).timeout(10000);

        it("should report when one container fails", async () => {
            const r = {
                containers: [
                    {
                        args: ["true"],
                        image: "alpine:latest",
                        name: "alpine0",
                    },
                    {
                        args: ["false"],
                        image: "alpine:latest",
                        name: "alpine1",
                    },
                    {
                        args: ["true"],
                        image: "alpine:latest",
                        name: "alpine2",
                    },
                ],
            };
            const e = executeDockerJob(g, r);
            const egr = await e(gi);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 1);
            assert(x.message.startsWith("Docker container 'sdm-alpine1-27c20de-container' failed"));
        }).timeout(10000);

        it("should allow containers to communitate", async () => {
            const r = {
                containers: [
                    {
                        args: ["sleep", "2"],
                        image: "alpine:latest",
                        name: "alpine0",
                    },
                    {
                        args: ["ping", "-w", "1", "alpine0"],
                        image: "alpine:latest",
                        name: "alpine1",
                    },
                ],
            };
            const e = executeDockerJob(g, r);
            const egr = await e(gi);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
        }).timeout(15000);

    });

});
