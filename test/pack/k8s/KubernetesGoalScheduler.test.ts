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

import * as ac from "@atomist/automation-client";
import { SdmGoalEvent } from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";
import * as assert from "power-assert";
import {
    isConfiguredInEnv,
    k8sJobEnv,
    k8sJobName,
} from "../../../lib/pack/k8s/KubernetesGoalScheduler";

describe("KubernetesGoalScheduler", () => {

    describe("isConfiguredInEnv", () => {

        let gEnvVar: string;
        let lEnvVar: string;

        beforeEach(() => {
            gEnvVar = process.env.ATOMIST_GOAL_SCHEDULER;
            delete process.env.ATOMIST_GOAL_SCHEDULER;
            lEnvVar = process.env.ATOMIST_GOAL_LAUNCHER;
            delete process.env.ATOMIST_GOAL_LAUNCHER;
        });

        afterEach(() => {
            process.env.ATOMIST_GOAL_SCHEDULER = gEnvVar;
            gEnvVar = undefined;
            process.env.ATOMIST_GOAL_LAUNCHER = lEnvVar;
            lEnvVar = undefined;
        });

        it("should detect missing value", () => {
            assert(!isConfiguredInEnv("kubernetes"));
        });

        it("should detect single string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "kubernetes";
            assert(isConfiguredInEnv("kubernetes"));
        });

        it("should detect multiple string value", () => {
            process.env.ATOMIST_GOAL_LAUNCHER = "kubernetes";
            assert(isConfiguredInEnv("kubernetes-all", "kubernetes"));
        });

        it("should detect single json string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "\"kubernetes\"";
            assert(isConfiguredInEnv("kubernetes-all", "kubernetes"));
        });

        it("should detect single json array string value", () => {
            process.env.ATOMIST_GOAL_LAUNCHER = "[\"kubernetes\"]";
            assert(isConfiguredInEnv("kubernetes-all", "kubernetes"));
        });

        it("should detect multiple json array string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "[\"kubernetes-all\", \"docker\"]";
            assert(isConfiguredInEnv("docker", "kubernetes"));
        });

    });

    describe("k8sJobName", () => {

        it("should return a job name", () => {
            const p: k8s.V1Pod = {
                spec: {
                    containers: [
                        {
                            name: "wild-horses",
                        },
                    ],
                },
            } as any;
            const g: SdmGoalEvent = {
                goalSetId: "abcdef0-123456789-abcdef",
                uniqueName: "Sundown.ts#L74",
            } as any;
            const n = k8sJobName(p, g);
            const e = "wild-horses-job-abcdef0-sundown.ts";
            assert(n === e);
        });

        it("should truncate a long job name", () => {
            const p: k8s.V1Pod = {
                spec: {
                    containers: [
                        {
                            name: "whos-gonna-ride-your-wild-horses",
                        },
                    ],
                },
            } as any;
            const g: SdmGoalEvent = {
                goalSetId: "abcdef0-123456789-abcdef",
                uniqueName: "SomewhereNorthOfNashville.ts#L74",
            } as any;
            const n = k8sJobName(p, g);
            const e = "whos-gonna-ride-your-wild-horses-job-abcdef0-somewherenorthofna";
            assert(n === e);
        });

        it("should safely truncate a long job name", () => {
            const p: k8s.V1Pod = {
                spec: {
                    containers: [
                        {
                            name: "i-think-theyve-got-your-alias-youve-been-living-un",
                        },
                    ],
                },
            } as any;
            const g: SdmGoalEvent = {
                goalSetId: "abcdef0-123456789-abcdef",
                uniqueName: "SomewhereNorthOfNashville.ts#L74",
            } as any;
            const n = k8sJobName(p, g);
            const e = "i-think-theyve-got-your-alias-youve-been-living-un-job-abcdef0";
            assert(n === e);
        });

    });

    describe("k8sJobEnv", () => {

        let aci: any;
        before(() => {
            aci = (global as any).__runningAutomationClient;
            (global as any).__runningAutomationClient = {
                configuration: {
                    name: "@zombies/care-of-cell-44",
                },
            };
        });
        after(() => {
            (global as any).__runningAutomationClient = aci;
        });

        it("should produce a valid set of environment variables", () => {
            const p: k8s.V1Pod = {
                spec: {
                    containers: [
                        {
                            name: "brief-candles",
                        },
                    ],
                },
            } as any;
            const g: SdmGoalEvent = {
                goalSetId: "0abcdef-123456789-abcdef",
                id: "CHANGES",
                uniqueName: "BeechwoodPark.ts#L243",
            } as any;
            const c: ac.HandlerContext = {
                context: {
                    workspaceName: "Odessey and Oracle",
                },
                correlationId: "fedcba9876543210-0123456789abcdef-f9e8d7c6b5a43210",
                workspaceId: "AR05343M1LY",
            } as any;
            const v = k8sJobEnv(p, g, c);
            const e = [
                {
                    name: "ATOMIST_JOB_NAME",
                    value: "brief-candles-job-0abcdef-beechwoodpark.ts",
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
            ];
            assert.deepStrictEqual(v, e);
        });

    });

});
