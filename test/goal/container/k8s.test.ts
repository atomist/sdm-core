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
    GitCommandGitProject,
    GitProject,
    guid,
    InMemoryProject,
    NodeFsLocalProject,
} from "@atomist/automation-client";
import {
    execPromise,
    // ExecuteGoalResult,
    fakePush,
    GoalInvocation,
    RepoContext,
    SdmGoalEvent,
    SdmGoalState,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as assert from "power-assert";
import { Container } from "../../../lib/goal/container/container";
import {
    executeK8sJob,
    K8sContainerRegistration,
    k8sFulfillmentCallback,
} from "../../../lib/goal/container/k8s";
import { KubernetesGoalScheduler } from "../../../lib/pack/k8s/KubernetesGoalScheduler";
import { containerTestImage } from "./util";

/* tslint:disable:max-file-line-count */

describe("goal/container/k8s", () => {

    describe("k8sFulfillmentCallback", () => {

        let rac: any;
        let gcgpc: any;
        before(() => {
            rac = (global as any).__runningAutomationClient;
            (global as any).__runningAutomationClient = {
                configuration: {
                    name: "@zombies/care-of-cell-44",
                },
            };
            gcgpc = GitCommandGitProject.cloned;
            GitCommandGitProject.cloned = async () => InMemoryProject.of() as any;
        });
        after(() => {
            (global as any).__runningAutomationClient = rac;
            GitCommandGitProject.cloned = gcgpc;
        });

        const g: Container = new Container();
        const sge: SdmGoalEvent = {
            branch: "psychedelic-rock",
            goalSetId: "0abcdef-123456789-abcdef",
            id: "CHANGES",
            repo: {
                name: "odessey-and-oracle",
                owner: "TheZombies",
                providerId: "CBS",
            },
            sha: "7ee1af8ee2f80ad1e718dbb2028120b3a2984892",
            uniqueName: "BeechwoodPark.ts#L243",
        } as any;
        const kgs = new KubernetesGoalScheduler();
        kgs.podSpec = {
            spec: {
                containers: [
                    {
                        image: "rod/argent:1945.6.14",
                        name: "rod-argent",
                    },
                ],
            },
        } as any;
        const rc: RepoContext = {
            configuration: {
                sdm: {
                    goalScheduler: [kgs],
                },
            },
            context: {
                context: {
                    workspaceName: "Odessey and Oracle",
                },
                correlationId: "fedcba9876543210-0123456789abcdef-f9e8d7c6b5a43210",
                graphClient: {
                    query: async () => ({ SdmVersion: [{ version: "1968.4.19" }] }),
                },
                workspaceId: "AR05343M1LY",
            },
        } as any;

        it("should add k8s service to goal event data", async () => {
            const r: K8sContainerRegistration = {
                containers: [
                    {
                        args: ["true"],
                        image: "colin/blunstone:1945.6.24",
                        name: "colin-blunstone",
                    },
                ],
                name: "MaybeAfterHesGone",
            };
            const c = k8sFulfillmentCallback(g, r);
            const ge = await c(sge, rc);
            const p = JSON.parse(ge.data);
            const d = {
                "@atomist/sdm/service": {
                    MaybeAfterHesGone: {
                        type: "@atomist/sdm/service/k8s",
                        spec: {
                            initContainer: {
                                name: "atm-init",
                                image: "rod/argent:1945.6.14",
                                workingDir: "/atm/home",
                                volumeMounts: [
                                    {
                                        mountPath: "/atm/home",
                                        name: "home",
                                    },
                                ],
                                env: [
                                    {
                                        name: "ATOMIST_JOB_NAME",
                                        value: "rod-argent-job-0abcdef-beechwoodpark.ts",
                                    },
                                    {
                                        name: "ATOMIST_REGISTRATION_NAME",
                                        value: `@zombies/care-of-cell-44-job-0abcdef-beechwoodpark.ts`,
                                    },
                                    {
                                        name: "ATOMIST_GOAL_TEAM",
                                        value: "AR05343M1LY",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_TEAM_NAME",
                                        value: "Odessey and Oracle",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_ID",
                                        value: "CHANGES",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_SET_ID",
                                        value: "0abcdef-123456789-abcdef",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_UNIQUE_NAME",
                                        value: "BeechwoodPark.ts#L243",
                                    },
                                    {
                                        name: "ATOMIST_CORRELATION_ID",
                                        value: "fedcba9876543210-0123456789abcdef-f9e8d7c6b5a43210",
                                    },
                                    {
                                        name: "ATOMIST_ISOLATED_GOAL",
                                        value: "true",
                                    },
                                    {
                                        name: "ATOMIST_ISOLATED_GOAL_INIT",
                                        value: "true",
                                    },
                                ],
                            },
                            container: [
                                {
                                    args: ["true"],
                                    env: [
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
                                            name: "ATOMIST_GOAL_SET_ID",
                                            value: "0abcdef-123456789-abcdef",
                                        },
                                        {
                                            name: "ATOMIST_GOAL",
                                            value: "BeechwoodPark.ts#L243",
                                        },
                                    ],
                                    image: "colin/blunstone:1945.6.24",
                                    name: "colin-blunstone",
                                    workingDir: "/atm/home",
                                },
                            ],
                            volume: [
                                {
                                    name: "home",
                                    emptyDir: {},
                                },
                            ],
                            volumeMount: [
                                {
                                    mountPath: "/atm/home",
                                    name: "home",
                                },
                            ],
                        },
                    },
                },
            };
            assert.deepStrictEqual(p, d);
            delete ge.data;
            const e = {
                branch: "psychedelic-rock",
                goalSetId: "0abcdef-123456789-abcdef",
                id: "CHANGES",
                repo: {
                    name: "odessey-and-oracle",
                    owner: "TheZombies",
                    providerId: "CBS",
                },
                sha: "7ee1af8ee2f80ad1e718dbb2028120b3a2984892",
                uniqueName: "BeechwoodPark.ts#L243",
            };
            assert.deepStrictEqual(ge, e);
        });

        it("should throw an error if there are no containers", async () => {
            const r: K8sContainerRegistration = {
                containers: [],
            };
            const c = k8sFulfillmentCallback(g, r);
            try {
                await c(sge, rc);
                assert.fail("callback should have thrown an error");
            } catch (e) {
                assert(/No containers defined in K8sGoalContainerSpec/.test(e.message));
            }
        });

        it("should merge k8s service into registration and use callback", async () => {
            const r: K8sContainerRegistration = {
                callback: async () => {
                    return {
                        containers: [
                            {
                                args: ["first"],
                                env: [
                                    {
                                        name: "GENRE",
                                        value: "Baroque pop",
                                    },
                                    {
                                        name: "STUDIO",
                                        value: "Abbey Road",
                                    },
                                ],
                                image: "colin/blunstone:1945.6.24",
                                name: "colin-blunstone",
                                volumeMounts: [
                                    {
                                        mountPath: "/willy",
                                        name: "tempest",
                                    },
                                ],
                                workingDir: "/abbey/road",
                            },
                            {
                                args: ["second"],
                                env: [
                                    {
                                        name: "INSTRUMENT",
                                        value: "Bass",
                                    },
                                ],
                                image: "chris/white:1943.3.7",
                                name: "chris-white",
                                volumeMounts: [
                                    {
                                        mountPath: "/bill",
                                        name: "tempest",
                                    },
                                ],
                            },
                        ],
                    };
                },
                containers: [],
                volumes: [
                    {
                        hostPath: {
                            path: "/william/shakespeare",
                        },
                        name: "tempest",
                    },
                ],
                name: "MaybeAfterHesGone",
            };
            const c = k8sFulfillmentCallback(g, r);
            const ge = await c(sge, rc);
            const p = JSON.parse(ge.data);
            const d = {
                "@atomist/sdm/service": {
                    MaybeAfterHesGone: {
                        type: "@atomist/sdm/service/k8s",
                        spec: {
                            initContainer: {
                                env: [
                                    {
                                        name: "ATOMIST_JOB_NAME",
                                        value: "rod-argent-job-0abcdef-beechwoodpark.ts",
                                    },
                                    {
                                        name: "ATOMIST_REGISTRATION_NAME",
                                        value: `@zombies/care-of-cell-44-job-0abcdef-beechwoodpark.ts`,
                                    },
                                    {
                                        name: "ATOMIST_GOAL_TEAM",
                                        value: "AR05343M1LY",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_TEAM_NAME",
                                        value: "Odessey and Oracle",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_ID",
                                        value: "CHANGES",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_SET_ID",
                                        value: "0abcdef-123456789-abcdef",
                                    },
                                    {
                                        name: "ATOMIST_GOAL_UNIQUE_NAME",
                                        value: "BeechwoodPark.ts#L243",
                                    },
                                    {
                                        name: "ATOMIST_CORRELATION_ID",
                                        value: "fedcba9876543210-0123456789abcdef-f9e8d7c6b5a43210",
                                    },
                                    {
                                        name: "ATOMIST_ISOLATED_GOAL",
                                        value: "true",
                                    },
                                    {
                                        name: "ATOMIST_ISOLATED_GOAL_INIT",
                                        value: "true",
                                    },
                                ],
                                image: "rod/argent:1945.6.14",
                                name: "atm-init",
                                volumeMounts: [
                                    {
                                        mountPath: "/atm/home",
                                        name: "home",
                                    },
                                ],
                                workingDir: "/atm/home",
                            },
                            container: [
                                {
                                    args: ["first"],
                                    env: [
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
                                            name: "ATOMIST_GOAL_SET_ID",
                                            value: "0abcdef-123456789-abcdef",
                                        },
                                        {
                                            name: "ATOMIST_GOAL",
                                            value: "BeechwoodPark.ts#L243",
                                        },
                                        {
                                            name: "GENRE",
                                            value: "Baroque pop",
                                        },
                                        {
                                            name: "STUDIO",
                                            value: "Abbey Road",
                                        },
                                    ],
                                    image: "colin/blunstone:1945.6.24",
                                    name: "colin-blunstone",
                                    volumeMounts: [
                                        {
                                            mountPath: "/willy",
                                            name: "tempest",
                                        },
                                    ],
                                    workingDir: "/atm/home",
                                },
                                {
                                    args: ["second"],
                                    env: [
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
                                            name: "ATOMIST_GOAL_SET_ID",
                                            value: "0abcdef-123456789-abcdef",
                                        },
                                        {
                                            name: "ATOMIST_GOAL",
                                            value: "BeechwoodPark.ts#L243",
                                        },
                                        {
                                            name: "INSTRUMENT",
                                            value: "Bass",
                                        },
                                    ],
                                    image: "chris/white:1943.3.7",
                                    name: "chris-white",
                                    volumeMounts: [
                                        {
                                            mountPath: "/bill",
                                            name: "tempest",
                                        },
                                    ],
                                },
                            ],
                            volume: [
                                {
                                    name: "home",
                                    emptyDir: {},
                                },
                            ],
                            volumeMount: [
                                {
                                    mountPath: "/atm/home",
                                    name: "home",
                                },
                            ],
                        },
                    },
                },
            };
            assert.deepStrictEqual(p, d);
            delete ge.data;
            const e = {
                branch: "psychedelic-rock",
                goalSetId: "0abcdef-123456789-abcdef",
                id: "CHANGES",
                repo: {
                    name: "odessey-and-oracle",
                    owner: "TheZombies",
                    providerId: "CBS",
                },
                sha: "7ee1af8ee2f80ad1e718dbb2028120b3a2984892",
                uniqueName: "BeechwoodPark.ts#L243",
            };
            assert.deepStrictEqual(ge, e);
        });

    });

    describe("executeK8sJob", () => {

        const fakeId = fakePush().id;
        const goal = new Container();
        const tmpDirPrefix = "atomist-sdm-core-k8s-test";
        const projectDir = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
        let project: GitProject;
        const tmpDirs: string[] = [];
        let logData = "";
        const goalInvocation: GoalInvocation = {
            context: {
                graphClient: {
                    query: () => ({ SdmVersion: [{ version: "3.1.3-20200220200220" }] }),
                },
            },
            configuration: {
                sdm: {
                    projectLoader: {
                        doWithProject: (o, a) => a(project),
                    },
                },
            },
            credentials: {},
            goalEvent: {
                branch: fakeId.branch,
                goalSetId: "27c20de4-2c88-480a-b4e7-f6c6d5a1d623",
                repo: {
                    name: fakeId.repo,
                    owner: fakeId.owner,
                    providerId: "album",
                },
                sha: fakeId.sha,
                uniqueName: goal.definition.uniqueName,
            },
            id: fakeId,
            progressLog: {
                write: d => { logData += d; },
            },
        } as any;

        let cwd: string;
        before(async function minikubeCheckProjectSetup(): Promise<void> {
            // tslint:disable-next-line:no-invalid-this
            this.timeout(20000);
            try {
                // see if minikube is available and responding
                await execPromise("kubectl", ["config", "use-context", "minikube"]);
                await execPromise("kubectl", ["get", "--request-timeout=200ms", "pods"]);
            } catch (e) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
            cwd = process.cwd();
            await fs.ensureDir(projectDir);
            tmpDirs.push(projectDir);
            project = await NodeFsLocalProject.fromExistingDirectory(fakeId, projectDir) as any;
        });

        beforeEach(() => {
            process.chdir(cwd);
            logData = "";
        });

        after(async function directoryCleanup(): Promise<void> {
            await Promise.all(tmpDirs.map(d => fs.remove(d)));
        });

        it("should run in init mode and copy project", async () => {
            const r = {
                containers: [
                    {
                        args: ["true"],
                        image: containerTestImage,
                        name: "alpine",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const d = path.join(os.tmpdir(), `${tmpDirPrefix}-${guid()}`);
            await fs.ensureDir(d);
            tmpDirs.push(d);
            const f = `JUNK-${guid()}.md`;
            const fp = path.join(project.baseDir, f);
            await fs.writeFile(fp, "Counting the days until they set you free again\n");
            const dp = path.join(d, f);
            assert(!fs.existsSync(dp));
            process.chdir(d);
            process.env.ATOMIST_ISOLATED_GOAL_INIT = "true";
            const egr = await e(goalInvocation);
            delete process.env.ATOMIST_ISOLATED_GOAL_INIT;
            process.chdir(cwd);
            await fs.unlink(fp);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as SdmGoalEvent;
            const eg = {
                branch: fakeId.branch,
                goalSetId: "27c20de4-2c88-480a-b4e7-f6c6d5a1d623",
                repo: {
                    name: fakeId.repo,
                    owner: fakeId.owner,
                    providerId: "album",
                },
                sha: fakeId.sha,
                state: SdmGoalState.in_process,
                uniqueName: goal.definition.uniqueName,
            };
            assert.deepStrictEqual(x, eg, logData);
            const ec = await fs.readFile(path.join(d, f), "utf8");
            assert(ec === "Counting the days until they set you free again\n");
        }).timeout(10000);

        /*
        it("should report when the container fails", async () => {
            const r = {
                containers: [
                    {
                        args: ["false"],
                        image: containerTestImage,
                        name: "alpine",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const egr = await e(goalInvocation);
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
                        image: containerTestImage,
                        name: "alpine0",
                    },
                    {
                        args: ["true"],
                        image: containerTestImage,
                        name: "alpine1",
                    },
                    {
                        args: ["true"],
                        image: containerTestImage,
                        name: "alpine2",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const egr = await e(goalInvocation);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
        }).timeout(10000);

        it("should report when main container fails", async () => {
            const r = {
                containers: [
                    {
                        args: ["false"],
                        image: containerTestImage,
                        name: "alpine0",
                    },
                    {
                        args: ["true"],
                        image: containerTestImage,
                        name: "alpine1",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const egr = await e(goalInvocation);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 1);
            assert(x.message.startsWith("Docker container 'sdm-alpine0-27c20de-container' failed"));
        }).timeout(10000);

        it("should ignore when sidecar container fails", async () => {
            const r = {
                containers: [
                    {
                        args: ["true"],
                        image: containerTestImage,
                        name: "alpine0",
                    },
                    {
                        args: ["false"],
                        image: containerTestImage,
                        name: "alpine1",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const egr = await e(goalInvocation);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
        }).timeout(10000);

        it("should allow containers to communicate", async () => {
            const r = {
                containers: [
                    {
                        args: ["sleep", "2"],
                        image: containerTestImage,
                        name: "alpine0",
                    },
                    {
                        args: ["ping", "-w", "1", "alpine0"],
                        image: containerTestImage,
                        name: "alpine1",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const egr = await e(goalInvocation);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
        }).timeout(15000);

        it("should only wait on main container", async () => {
            const r = {
                containers: [
                    {
                        args: ["true"],
                        image: containerTestImage,
                        name: "alpine0",
                    },
                    {
                        args: ["sleep", "20"],
                        image: containerTestImage,
                        name: "alpine1",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const egr = await e(goalInvocation);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
        }).timeout(10000);

        it("should persist changes to project", async () => {
            const tmpDir = path.join(os.tmpdir(), "atomist-sdm-core-docker-test-" + guid());
            await fs.ensureDir(tmpDir);
            tmpDirs.push(tmpDir);
            const existingFile = `README.${guid()}`;
            const existingFilePath = path.join(tmpDir, existingFile);
            await fs.writeFile(existingFilePath, "# After Hours\n");
            const changeFile = `pigeonCamera.${guid()}`;
            const changeFilePath = path.join(tmpDir, changeFile);
            await fs.writeFile(changeFilePath, "Where's my pigeon camera?\n");
            const deleteFile = `ifyouclosethedoor_${guid()}`;
            const deleteFilePath = path.join(tmpDir, deleteFile);
            await fs.writeFile(deleteFilePath, "you won't see me\nyou won't see me\n");
            const lid = fakePush().id;
            const lp: GitProject = await NodeFsLocalProject.fromExistingDirectory(lid, tmpDir) as any;
            const lgi: GoalInvocation = {
                context: {
                    graphClient: {
                        query: () => ({ SdmVersion: [{ version: "3.1.3-20200220200220" }] }),
                    },
                },
                configuration: {
                    sdm: {
                        projectLoader: {
                            doWithProject: (o, a) => a(lp),
                        },
                    },
                },
                credentials: {},
                goalEvent: {
                    branch: lid.branch,
                    goalSetId: "27c20de4-2c88-480a-b4e7-f6c6d5a1d623",
                    repo: {
                        name: lid.repo,
                        owner: lid.owner,
                        providerId: "album",
                    },
                    sha: lid.sha,
                    uniqueName: goal.definition.uniqueName,
                },
                id: lid,
                progressLog: {
                    write: () => { },
                },
            } as any;
            const newFile = `project-test-0-${guid()}`;
            const newFilePath = path.join(tmpDir, newFile);
            const r = {
                containers: [
                    {
                        args: [
                            `echo 'This is only a local test' > ${newFile}` +
                            `; echo 'By now it could be anywhere.' >> ${changeFile}` +
                            `; rm ${deleteFile}`,
                        ],
                        command: ["sh", "-c"],
                        image: containerTestImage,
                        name: "alpine0",
                    },
                ],
            };
            const edj = executeK8sJob(goal, r);
            const egr = await edj(lgi);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
            const t = await lp.getFile(newFile);
            assert(t, "file created in container does not exist");
            const tc = await t.getContent();
            assert(tc === "This is only a local test\n");
            const tcf = await fs.readFile(newFilePath, "utf8");
            assert(tcf === "This is only a local test\n");
            const e = await lp.getFile(existingFile);
            assert(e, "file existing in project disappeared");
            const ec = await e.getContent();
            assert(ec === "# After Hours\n");
            const ecf = await fs.readFile(existingFilePath, "utf8");
            assert(ecf === "# After Hours\n");
            const c = await lp.getFile(changeFile);
            assert(c, "file changed in project disappeared");
            const cc = await c.getContent();
            assert(cc === "Where's my pigeon camera?\nBy now it could be anywhere.\n");
            const ccf = await fs.readFile(changeFilePath, "utf8");
            assert(ccf === "Where's my pigeon camera?\nBy now it could be anywhere.\n");
            assert(!await lp.getFile(deleteFile), "deleted file still exists in project");
            assert(!fs.existsSync(deleteFilePath), "deleted file still exists on file system");
        }).timeout(10000);

        it("should use volumes", async () => {
            const tmpDir = path.join(os.homedir(), ".atomist", "tmp", guid());
            await fs.ensureDir(tmpDir);
            tmpDirs.push(tmpDir);
            const tmpFile = `volume-test-0-${guid()}`;
            const r = {
                containers: [
                    {
                        args: [`echo 'This is only a test' > /test/vol0/${tmpFile}`],
                        command: ["sh", "-c"],
                        image: containerTestImage,
                        name: "alpine0",
                        volumeMounts: [
                            {
                                mountPath: "/test/vol0",
                                name: "test-volume",
                            },
                        ],
                    },
                ],
                volumes: [
                    {
                        hostPath: {
                            path: tmpDir,
                        },
                        name: "test-volume",
                    },
                ],
            };
            const e = executeK8sJob(goal, r);
            const egr = await e(goalInvocation);
            assert(egr, "ExecuteGoal did not return a value");
            const x = egr as ExecuteGoalResult;
            assert(x.code === 0);
            assert(x.message === "Successfully completed container job");
            const tmpFilePath = path.join(tmpDir, tmpFile);
            const tmpContent = await fs.readFile(tmpFilePath, "utf8");
            assert(tmpContent === "This is only a test\n");
        }).timeout(10000);
        */

    });

});
