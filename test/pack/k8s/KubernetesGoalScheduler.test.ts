import * as assert from "power-assert";
import { isConfiguredInEnv } from "../../../lib/pack/k8s/KubernetesGoalScheduler";

describe("KubernetesGoalScheduler", () => {

    describe("isConfiguredInEnv", () => {

        let envVar: string;

        beforeEach(() => {
            envVar = process.env.ATOMIST_GOAL_SCHEDULER;
            delete process.env.ATOMIST_GOAL_SCHEDULER;
        });

        afterEach(() => {
            process.env.ATOMIST_GOAL_SCHEDULER = envVar;
            envVar = undefined;
        });

        it("should detect missing value", () => {
            assert(!isConfiguredInEnv("kubernetes"));
        });

        it("should detect single string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "kubernetes";
            assert(isConfiguredInEnv("kubernetes"));
        });

        it("should detect multiple string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "kubernetes";
            assert(isConfiguredInEnv("kubernetes-all", "kubernetes"));
        });

        it("should detect single json string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "\"kubernetes\"";
            assert(isConfiguredInEnv("kubernetes-all", "kubernetes"));
        });

        it("should detect single json array string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "[\"kubernetes\"]";
            assert(isConfiguredInEnv("kubernetes-all", "kubernetes"));
        });

        it("should detect multiple json array string value", () => {
            process.env.ATOMIST_GOAL_SCHEDULER = "[\"kubernetes-all\", \"docker\"]";
            assert(isConfiguredInEnv("docker", "kubernetes"));
        });

    });

});
