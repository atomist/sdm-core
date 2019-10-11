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

import { DefaultHttpClientFactory } from "@atomist/automation-client";
import {
    goal,
    ImmaterialGoals,
    Locking,
} from "@atomist/sdm";
import * as assert from "power-assert";
import { Container } from "../../../lib/goal/container/container";
import { DockerContainerRegistration } from "../../../lib/goal/container/docker";
import {
    GoalMaker,
    mapGoals,
    resolvePlaceholder,
} from "../../../lib/machine/yaml/mapGoals";

describe("mapGoals", () => {

    it("should error for unkown goal", async () => {
        const yaml = "unknown-goal";
        try {
            await mapGoals(undefined, yaml, {}, {}, {}, {});
            assert.fail();
        } catch (e) {
            assert.deepStrictEqual(e.message, "Unable to construct goal from '\"unknown-goal\"'");
        }
    });

    it("should map immaterial goals", async () => {
        const yaml = "immaterial";
        const goals = await mapGoals(undefined, yaml, {}, {}, {}, {});
        assert.deepStrictEqual(goals, ImmaterialGoals.andLock().goals);
    });

    it("should map locking goal", async () => {
        const yaml = "lock";
        const goals = await mapGoals(undefined, yaml, {}, {}, {}, {});
        assert.deepStrictEqual(goals, Locking);
    });

    it("should map additional goal", async () => {
        const sampleGoal = goal({ displayName: "Sample Goal" });
        const yaml = "sampleGoal";
        const goals = await mapGoals(undefined, yaml, { sampleGoal }, {}, {}, {});
        assert.deepStrictEqual(goals, sampleGoal);
    });

    it("should map goalMaker goal", async () => {
        const sampleGoal = goal({ displayName: "Sample Goal" });
        const sampleGoalMaker: GoalMaker = async sdm => sampleGoal;
        const yaml = "sampleGoal";
        const goals = await mapGoals(undefined, yaml, {}, { sampleGoal: sampleGoalMaker }, {}, {});
        assert.deepStrictEqual(goals, sampleGoal);
    });

    it("should map goalMaker goal with parameters", async () => {
        const yaml = {
            sampleGoal: {
                foo: "bar",
            },
        };
        const sampleGoal = goal({ displayName: "Sample Goal" });
        const sampleGoalMaker: GoalMaker = async (sdm, params) => {
            assert.deepStrictEqual(params, yaml.sampleGoal);
            return sampleGoal;
        };
        const goals = await mapGoals(undefined, yaml, {}, { sampleGoal: sampleGoalMaker }, {}, {});
        assert.deepStrictEqual(goals, sampleGoal);
    });

    it("should map container goal", async () => {
        const yaml: DockerContainerRegistration = {
            containers: [{
                name: "mongo",
                image: "mongo:latest",
                volumeMounts: [{
                    name: "cache",
                    mountPath: "/cache",
                }],
                secrets: [{
                    env: [{ name: "TEST", value: { encrypted: "sdfsdg34049tzewrghiokblsvbjskdv" } }],
                }],
            }],
            volumes: [{
                name: "cache",
                hostPath: {
                    path: "/tmp/cache",
                },
            }],
            input: ["dependencies"],
            output: [{
                classifier: "scripts",
                pattern: {
                    globPattern: "*/*.js",
                },
            }],
            approval: true,
            preApproval: true,
            retry: true,
            descriptions: {
                completed: "What am awesome mongo goal",
            },
        } as any;
        const goals = await mapGoals(undefined, yaml, {}, {}, {}, {}) as Container;
        assert.deepStrictEqual(goals.definition.retryFeasible, true);
        assert.deepStrictEqual(goals.definition.approvalRequired, true);
        assert.deepStrictEqual(goals.definition.preApprovalRequired, true);
        assert.deepStrictEqual(goals.definition.completedDescription, (yaml as any).descriptions.completed);
        assert.deepStrictEqual(goals.registrations[0].volumes, yaml.volumes);
        assert.deepStrictEqual(goals.registrations[0].input, yaml.input);
        assert.deepStrictEqual(goals.registrations[0].output, yaml.output);
    });

    it("should map goals from array", async () => {
        const sampleGoal1 = goal({ displayName: "Sample Goal1" });
        const sampleGoal2 = goal({ displayName: "Sample Goal2" });
        const yaml = ["sampleGoal1", "sampleGoal2"];
        const goals = await mapGoals(undefined, yaml, { sampleGoal1, sampleGoal2 }, {}, {}, {});
        assert.deepStrictEqual(goals, [sampleGoal1, sampleGoal2]);
    });

    it("should map referenced goal", async () => {
        const yaml = { "atomist/version-goal/version@master": { containers: [{ image: "foo/bar" }] } };
        const goals = await mapGoals({ configuration: { http: { client: { factory: DefaultHttpClientFactory } } } } as any, yaml, {}, {}, {}, {});
        assert(!!goals);
    });

});

describe("resolvePlaceholders", () => {

    it("should replace text in value", async () => {
        // tslint:disable-next-line:no-invalid-template-strings
        const value = "The quick ${color} fox jumps over the ${attribute} dog";
        const result = await resolvePlaceholder(value, {} as any, {
            configuration: {
                color: "brown",
                attribute: "lazy",
            },
        } as any);
        assert.deepStrictEqual(result, "The quick brown fox jumps over the lazy dog");
    });

    it("should replace entire object", async () => {
        // tslint:disable-next-line:no-invalid-template-strings
        const value = "${colors}";
        const result = await resolvePlaceholder(value, {} as any, {
            configuration: {
                colors: {
                    blue: "yes",
                    orange: "nah",
                },
            },
        } as any);
        assert.deepStrictEqual(result, { blue: "yes", orange: "nah" });
    });

});
