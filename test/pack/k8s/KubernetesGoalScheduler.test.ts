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

import * as assert from "power-assert";
import { isConfiguredInEnv } from "../../../lib/pack/k8s/KubernetesGoalScheduler";

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

});
