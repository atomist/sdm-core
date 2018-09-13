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
    HandlerContext,
    logger,
    Success,
} from "@atomist/automation-client";
import { guid } from "@atomist/automation-client/lib/internal/util/string";
import { GitHubRepoRef } from "@atomist/automation-client/lib/operations/common/GitHubRepoRef";
import { ProjectOperationCredentials } from "@atomist/automation-client/lib/operations/common/ProjectOperationCredentials";
import { InMemoryProject } from "@atomist/automation-client/lib/project/mem/InMemoryProject";
import {
    Autofix,
    GoalWithFulfillment,
    resetRegistrableManager,
} from "@atomist/sdm";
import { determineGoals } from "@atomist/sdm/lib/api-helper/goal/chooseAndSetGoals";
import { SingleProjectLoader } from "@atomist/sdm/lib/api-helper/test/SingleProjectLoader";
import { whenPushSatisfies } from "@atomist/sdm/lib/api/dsl/goalDsl";
import { Goals } from "@atomist/sdm/lib/api/goal/Goals";
import { SdmGoalEvent } from "@atomist/sdm/lib/api/goal/SdmGoalEvent";
import {
    SoftwareDeliveryMachineConfiguration,
    SoftwareDeliveryMachineOptions,
} from "@atomist/sdm/lib/api/machine/SoftwareDeliveryMachineOptions";
import { AnyPush } from "@atomist/sdm/lib/api/mapping/support/commonPushTests";
import { PushFields } from "@atomist/sdm/lib/typings/types";
import * as assert from "power-assert";
import { DefaultRepoRefResolver } from "../../lib/handlers/common/DefaultRepoRefResolver";
import { createSoftwareDeliveryMachine } from "../../lib/machine/machineFactory";

const favoriteRepoRef = GitHubRepoRef.from({
    owner: "jess",
    repo: "monet",
    sha: "75132357b19889c4d6c2bef99fce8f477e1f2196",
    branch: "claude",
});

export const fakeSoftwareDeliveryMachineOptions = {
    projectLoader: new SingleProjectLoader(InMemoryProject.from(favoriteRepoRef,
        { path: "README.md", content: "read something else" })),
} as any as SoftwareDeliveryMachineOptions;

export const fakeSoftwareDeliveryMachineConfiguration: SoftwareDeliveryMachineConfiguration = {
    name: "fakeSoftwareDeliverMachine",
    sdm: fakeSoftwareDeliveryMachineOptions,
};

const credentials: ProjectOperationCredentials = { token: "ab123bbbaaa" };

const fakeContext = { context: { name: "my favorite context " } } as any as HandlerContext;

const aPush = {
    repo: {
        org: {
            provider: {
                providerId: "myProviderId",
            },
        },
    },
    commits: [{
        sha: guid(),
    }],

} as PushFields.Fragment;

describe("implementing goals in the SDM", () => {

    afterEach(() => {
        resetRegistrableManager();
    });

    it("can autofix", async () => {
        const mySDM = createSoftwareDeliveryMachine(
            { name: "Gustave", configuration: fakeSoftwareDeliveryMachineConfiguration });
        const autofixGoal = new Autofix();
        mySDM.addGoalContributions(whenPushSatisfies(AnyPush)
            .itMeans("autofix the crap out of that thing")
            .setGoals(new Goals("Autofix only", autofixGoal)));

        const { determinedGoals, goalsToSave } = await determineGoals({
                projectLoader: fakeSoftwareDeliveryMachineOptions.projectLoader,
                repoRefResolver: new DefaultRepoRefResolver(),
                goalSetter: mySDM.pushMapping,
                implementationMapping: mySDM.goalFulfillmentMapper,
            }, {
                credentials,
                id: favoriteRepoRef,
                context: fakeContext,
                push: aPush,
                addressChannels: () => Promise.resolve({}),
                goalSetId: "hi",
            },
        );

        assert(determinedGoals.goals.some(g => g.name === autofixGoal.name));
        assert.strictEqual(goalsToSave.length, 1);
        const onlyGoal = goalsToSave[0];

        const myImpl = mySDM.goalFulfillmentMapper.findImplementationBySdmGoal(onlyGoal as any as SdmGoalEvent);
        assert(myImpl.implementationName.endsWith(autofixGoal.definition.uniqueName));
    });

    it("I can teach it to do a custom goal", async () => {

        const customGoal = new GoalWithFulfillment({
            uniqueName: "Jerry",
            displayName: "Springer", environment: "1-staging/", orderedName: "1-springer",
        });

        let executed: boolean = false;
        const goalExecutor = async () => {
            executed = true;
            return Success;
        };

        const mySDM = createSoftwareDeliveryMachine(
            { name: "Gustave", configuration: fakeSoftwareDeliveryMachineConfiguration },
            whenPushSatisfies(AnyPush)
                .itMeans("cornelius springer")
                .setGoals(new Goals("Springer", customGoal.with({ goalExecutor, name: "Cornelius" }))));

        const { determinedGoals, goalsToSave } = await determineGoals({
                projectLoader: fakeSoftwareDeliveryMachineOptions.projectLoader,
                repoRefResolver: new DefaultRepoRefResolver(),
                goalSetter: mySDM.pushMapping,
                implementationMapping: mySDM.goalFulfillmentMapper,
            }, {
                credentials, id: favoriteRepoRef, context: fakeContext, push: aPush,
                addressChannels: () => Promise.resolve({}),
                goalSetId: "hi",
            },
        );
        assert(determinedGoals.goals.some(g => g.name === customGoal.name));
        assert.strictEqual(goalsToSave.length, 1);
        const onlyGoal = goalsToSave[0];
        const myImpl = mySDM.goalFulfillmentMapper.findImplementationBySdmGoal(onlyGoal as any as SdmGoalEvent);
        assert.strictEqual(myImpl.implementationName, "Cornelius");
        await myImpl.goalExecutor(undefined);
        assert(executed);
    });

});
