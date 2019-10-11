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

import { MessageClient } from "@atomist/automation-client";
import {
    GoalSigningConfiguration,
    GoalSigningScope,
    SdmGoalState,
} from "@atomist/sdm";
import {
    SdmGoalFulfillmentMethod,
    SdmGoalMessage,
} from "@atomist/sdm/lib/api/goal/SdmGoalMessage";
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import * as assert from "power-assert";
import {
    signGoal,
    verifyGoal,
} from "../../../lib/internal/signing/goalSigning";

describe("goalSigning", () => {

    const publicKey = fs.readFileSync(path.join(__dirname, "sdm-core-test-public.pem")).toString();
    const privateKey = fs.readFileSync(path.join(__dirname, "sdm-core-test.pem")).toString();
    const passphrase = "123456";

    const goalMessage: SdmGoalMessage = {
        environment: "0-code",
        uniqueName: "build#goals.ts:42",
        name: "build",
        sha: "329f8ed3746d969233ef11c5cae72a3d9231a09d",
        branch: "master",
        fulfillment: {
            method: SdmGoalFulfillmentMethod.Sdm,
            name: "npm-run-build",
            registration: "@atomist/atomist-sdm",
        },
        description: "Building",
        descriptions: {} as any,
        url: "https://app.atomist.com/workspace/T29E48P34/logs/atomist/sdm-pack-node",
        externalUrls: [],
        state: SdmGoalState.in_process,
        phase: "npm compile",
        externalKey: "sdm/atomist/0-code/build#goals.ts:42",
        goalSet: "Build with Release",
        goalSetId: "61d31727-3006-4979-b846-9f20d4e16cdd",
        ts: 1550839105466,
        retryFeasible: true,
        preConditions: [
            {
                environment: "0-code",
                uniqueName: "autofix#goals.ts:41",
                name: "autofix",
            },
            {
                environment: "0-code",
                uniqueName: "version#goals.ts:40",
                name: "version",
            },
        ],
        approval: undefined,
        approvalRequired: false,
        preApproval: undefined,
        preApprovalRequired: false,
        provenance: [
            {
                registration: "@atomist/atomist-sdm-job-61d3172-build",
                version: "1.0.3-master.20190222122821",
                name: "FulfillGoalOnRequested",
                correlationId: "b14ac8be-43ce-4e68-b843-ec9e12449676",
                ts: 1550839105466,
            },
            {
                correlationId: "b14ac8be-43ce-4e68-b843-ec9e12449676",
                registration: "@atomist/atomist-sdm",
                name: "SetGoalState",
                version: "1.0.3-master.20190222122821",
                ts: 1550839066508,
                userId: undefined,
                channelId: undefined,
            },
            {
                correlationId: "fd6029dd-73f9-4941-8b64-c1591d58d9ec",
                registration: "@atomist/atomist-sdm-job-61d3172-build",
                name: "FulfillGoalOnRequested",
                version: "1.0.3-master.20190221080543",
                ts: 1550837963831,
                userId: undefined,
                channelId: undefined,
            },
            {
                correlationId: "fd6029dd-73f9-4941-8b64-c1591d58d9ec",
                registration: "@atomist/atomist-sdm",
                name: "RequestDownstreamGoalsOnGoalSuccess",
                version: "1.0.3-master.20190221080543",
                ts: 1550837901174,
                userId: undefined,
                channelId: undefined,
            },
            {
                correlationId: "fd6029dd-73f9-4941-8b64-c1591d58d9ec",
                registration: "@atomist/atomist-sdm",
                name: "SetGoalsOnPush",
                version: "1.0.3-master.20190221080543",
                ts: 1550837810077,
                userId: undefined,
                channelId: undefined,
            },
        ],
        data: undefined,
        version: 17,
        repo: {
            name: "sdm-pack-node",
            owner: "atomist",
            providerId: "zjlmxjzwhurspem",
        },
        parameters: JSON.stringify({ foo: "bar" }),
    };

    it("should correctly sign and verify goal", async () => {
        const gsc: GoalSigningConfiguration = {
            enabled: true,
            scope: GoalSigningScope.All,
            signingKey: { passphrase, publicKey, privateKey, name: "atomist.com/test" },
            verificationKeys: [{ publicKey, name: "atomist.com/test" }],
        };
        const signedGoal = await signGoal(_.cloneDeep(goalMessage) as any, gsc);
        assert(!!signedGoal.signature);
        await verifyGoal(signedGoal as any, gsc, {} as any);
    });

    it("should reject tampered goal", async () => {
        const gsc: GoalSigningConfiguration = {
            enabled: true,
            scope: GoalSigningScope.All,
            signingKey: { passphrase, publicKey, privateKey, name: "atomist.com/test" },
            verificationKeys: [{ publicKey, name: "atomist.com/test" }],
        };
        const signedGoal = await signGoal(_.cloneDeep(goalMessage) as any, gsc) as any;
        assert(!!signedGoal.signature);

        signedGoal.externalUrls = [{ url: "https://google.com", label: "Google" }];
        signedGoal.push = {
            repo: {
                name: "sdm-pack-node",
                owner: "atomist",
                org: {
                    provider: {
                        providerId: "zjlmxjzwhurspem",
                        apiUrl: "https://api.github.com",
                    },
                },
            },
        };

        const messageClient: MessageClient = {
            send: async (msg: any) => {
                assert.strictEqual(msg.state, SdmGoalState.failure);
                assert.strictEqual(msg.description, "Rejected: build");
                assert.strictEqual(msg.phase, "signature invalid");
            },
            respond: async (msg: any) => {
            },
        };

        try {
            await verifyGoal(signedGoal, gsc, { context: { name: "Test SDM" }, messageClient } as any);
        } catch (e) {
            assert.strictEqual(e.message, "SDM goal signature invalid. Rejecting goal!");
        }

        const maliciousOne = {
            ..._.cloneDeep(goalMessage)
            , uniqueName: "build#goals.ts:42\n        environment:prod\n        goalSetId:mwah-ahah-ahhh"
            , environment: "dev"
            , goalSetId: "aaaa-bbbb",
        };

        const maliciousTwo = {
            ..._.cloneDeep(goalMessage)
            , uniqueName: "build#goals.ts:42"
            , environment: "prod"
            , goalSetId: "mwah-ahah-ahhh\n        environment:dev\n        goalSetId:aaaa-bbbb",
        };

        const signedGoalMalOne = await signGoal(_.cloneDeep(maliciousOne) as any, gsc) as any;
        assert(!!signedGoal.signature);

        const signedGoalMalTwo = { ..._.cloneDeep(maliciousTwo), signature: signedGoalMalOne.signature };

        try {
            await verifyGoal(signedGoalMalTwo as any, gsc, { context: { name: "Test SDM" }, messageClient } as any);
            assert.fail();
        } catch (e) {
            assert.strictEqual(e.message, "SDM goal signature invalid. Rejecting goal!");
        }
    });

});
