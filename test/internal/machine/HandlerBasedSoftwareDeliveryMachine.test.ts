/*
 * Copyright © 2018 Atomist, Inc.
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
    fileExists,
    InMemoryFile,
    InMemoryProject,
    toFactory,
} from "@atomist/automation-client";
import {
    AnyPush,
    AutofixRegistration,
    Builder,
    ExtensionPack,
    fakePush,
    Goal,
    Goals,
    GoalsSetListener,
    hasFile,
    MessageGoal,
    PushImpact,
    PushListenerInvocation,
    pushTest,
    PushTest,
    whenPushSatisfies,
} from "@atomist/sdm";
import * as assert from "power-assert";
import { Build } from "../../../lib/goal/common/Build";
import { SetGoalsOnPush } from "../../../lib/handlers/events/delivery/goals/SetGoalsOnPush";
import { HandlerBasedSoftwareDeliveryMachine } from "../../../lib/internal/machine/HandlerBasedSoftwareDeliveryMachine";
import { fakeSoftwareDeliveryMachineConfiguration } from "../../blueprint/sdmGoalImplementation.test";

export const IsTypeScript: PushTest = pushTest(
    "Is TypeScript",
    async (pi: PushListenerInvocation) => fileExists(pi.project, "**/*.ts", () => true),
);

const AddThingAutofix: AutofixRegistration = {
    name: "AddThing",
    pushTest: IsTypeScript,
    transform: async (p, cri) => {
        await p.addFile("thing", "1");
        return { edited: true, success: true, target: p };
    },
};

const HasAtomistBuildFile = hasFile(".atomist/build.sh");

const fakeBuilder: Builder = {
    name: "fake",
    async initiateBuild() {
        // do nothing
    },
    logInterpreter: () => {
        return null;
    },
};

const NoGoals = new Goals("No action needed", new Goal({
    uniqueName: "nevermind",
    displayName: "immaterial",
    completedDescription: "No material changes",
}));

describe("SDM handler creation", () => {

    describe("emits event handlers", () => {

        it("emits goal setter", async () => {
            const sdm = new HandlerBasedSoftwareDeliveryMachine("Gustave",
                fakeSoftwareDeliveryMachineConfiguration,
                [whenPushSatisfies(AnyPush)
                    .itMeans("do nothing")
                    .setGoals(NoGoals)]);
            assert(sdm.eventHandlers.length > 0);
            const sgop = sdm.eventHandlers.map(h => toFactory(h)()).find(h => !!(h as SetGoalsOnPush).goalsListeners) as SetGoalsOnPush;
            assert(sgop.goalsListeners.length >= 0);
        });

        it("emits goal setter with listener", async () => {
            const gl: GoalsSetListener = async () => undefined;
            const sdm = new HandlerBasedSoftwareDeliveryMachine("Gustave",
                fakeSoftwareDeliveryMachineConfiguration,
                [whenPushSatisfies(AnyPush)
                    .itMeans("do nothing")
                    .setGoals(NoGoals)]);
            sdm.addGoalsSetListener(gl);
            assert(sdm.eventHandlers.length > 0);
            const sgop = sdm.eventHandlers.map(h => toFactory(h)()).find(h => !!(h as SetGoalsOnPush).goalsListeners) as SetGoalsOnPush;
            assert(sgop.goalsListeners.length >= 1);
        });

    });

    const HttpServiceGoals = new Goals("pretend HTTP Service Goals", new Build(), new PushImpact());

    describe("can test goal setting", () => {

        it("sets no goals", async () => {
            const sdm = new HandlerBasedSoftwareDeliveryMachine("Gustave",
                fakeSoftwareDeliveryMachineConfiguration,
                [whenPushSatisfies(AnyPush)
                    .itMeans("do nothing")
                    .setGoals(null)]);
            const p = fakePush();
            assert.equal(await sdm.pushMapping.mapping(p), undefined);
        });

        it("has pack-contributed behavior adding goals to no default", async () => {
            const sdm = new HandlerBasedSoftwareDeliveryMachine("Gustave",
                fakeSoftwareDeliveryMachineConfiguration,
                [whenPushSatisfies(AnyPush)
                    .itMeans("do nothing")
                    .setGoals(null)]);
            const p = fakePush();
            const ep: ExtensionPack = {
                name: "x",
                vendor: "Atomist",
                version: "0.1.0",
                configure: () => { /* do nothing */
                },
                goalContributions: whenPushSatisfies(() => true).setGoals(HttpServiceGoals),
            };
            sdm.addExtensionPacks(ep);
            assert.deepEqual((await sdm.pushMapping.mapping(p)).goals, HttpServiceGoals.goals);
        });

        it("sets goals on any push", async () => {
            const sdm = new HandlerBasedSoftwareDeliveryMachine("Gustave",
                fakeSoftwareDeliveryMachineConfiguration,
                [whenPushSatisfies(AnyPush)
                    .setGoals(HttpServiceGoals)]);
            const p = fakePush();
            assert.equal(await sdm.pushMapping.mapping(p), HttpServiceGoals);
        });

        it("sets goals on particular push", async () => {
            const project = InMemoryProject.of(new InMemoryFile("thing", "1"));
            const sdm = new HandlerBasedSoftwareDeliveryMachine("Gustave",
                fakeSoftwareDeliveryMachineConfiguration,
                [whenPushSatisfies(async pu => !!await pu.project.getFile("thing"))
                    .setGoals(HttpServiceGoals)]);
            const p = fakePush(project);
            assert.equal(await sdm.pushMapping.mapping(p), HttpServiceGoals);
        });

        it("sets goals on particular push with extra goals", async () => {
            const project = InMemoryProject.of(new InMemoryFile("thing", "1"));
            const sdm = new HandlerBasedSoftwareDeliveryMachine("Gustave",
                fakeSoftwareDeliveryMachineConfiguration,
                [whenPushSatisfies(async pu => !!await pu.project.getFile("thing"))
                    .setGoals(HttpServiceGoals)]);
            const p = fakePush(project);
            const ep: ExtensionPack = {
                name: "x",
                vendor: "Atomist",
                version: "0.1.0",
                configure: () => { /* do nothing */
                },
                // TODO why is this cast necessary?
                goalContributions: whenPushSatisfies(() => true)
                    .setGoals(MessageGoal as any),
            };
            sdm.addExtensionPacks(ep);
            assert.deepEqual((await sdm.pushMapping.mapping(p)).goals, HttpServiceGoals.goals.concat([MessageGoal as any]));
        });
    });

});
