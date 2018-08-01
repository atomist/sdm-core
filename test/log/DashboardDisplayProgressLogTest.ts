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

import {HandlerContext} from "@atomist/automation-client";
import {SdmGoal} from "@atomist/sdm/api/goal/SdmGoal";
import * as assert from "power-assert";
import {DashboardDisplayProgressLog} from "../../src/log/DashboardDisplayProgressLog";

describe("DashboardDisplayProgressLog", () => {

    const context: HandlerContext = {
        teamId: "TeamID",
        workspaceId: "TeamID",
        correlationId: "CorrelationID",
        messageClient: undefined,
    };

    const goal: SdmGoal = {
        push: {},
        repo: {
            owner: "RepoOwner",
            name: "RepoName",
            providerId: undefined,
        },
        sha: "SHA1",
        environment: "ENV",
        name: "GoalName",
        goalSetId: "GoalSetId",
        uniqueName: undefined,
        branch: undefined,
        fulfillment: undefined,
        description: undefined,
        goalSet: undefined,
        state: undefined,
        ts: undefined,
        provenance: undefined,
        preConditions: undefined,
    };

    it("should construct dashboard log URL", () => {
        const log = new DashboardDisplayProgressLog("http://rolarhost", 1000, 0,
            context, goal);
        assert.equal(log.url,
            "https://app.atomist.com/workspace/TeamID/logs/RepoOwner/RepoName/SHA1/ENV/GoalName/GoalSetId/CorrelationID");
    });

});
