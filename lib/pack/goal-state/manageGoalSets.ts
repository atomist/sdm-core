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
    addressEvent,
    Configuration,
    guid,
} from "@atomist/automation-client";
import { WebSocketLifecycle } from "@atomist/automation-client/lib/internal/transport/websocket/WebSocketLifecycle";
import { AbstractWebSocketMessageClient } from "@atomist/automation-client/lib/internal/transport/websocket/WebSocketMessageClient";
import * as namespace from "@atomist/automation-client/lib/internal/util/cls";
import {
    fetchGoalsForCommit,
    GoalSetRootType,
    goalSetState,
    SoftwareDeliveryMachine,
    TriggeredListener,
} from "@atomist/sdm";
import { pendingGoalSets } from "./cancelGoals";

/**
 * TriggeredListener that queries pending goal sets and updates their state according to state of
 * goals
 */
export const ManageGoalSetsTrigger: TriggeredListener = async li => {
    const workspaceIds = li.sdm.configuration.workspaceIds;
    if (!!workspaceIds && workspaceIds.length > 0) {
        for await (const workspaceId of workspaceIds) {
            const ses = namespace.create();
            ses.run(async () => {
                namespace.set({
                    invocationId: guid(),
                    correlationId: guid(),
                    workspaceName: workspaceId,
                    workspaceId: workspaceId,
                    operation: "ManagePendingGoalSets",
                    ts: Date.now(),
                    name: li.sdm.configuration.name,
                    version: li.sdm.configuration.version,
                });
                await manageGoalSets(workspaceId, li.sdm);
            });
        }
    }
};

async function manageGoalSets(workspaceId: string, sdm: SoftwareDeliveryMachine): Promise<void> {
    const graphClient = sdm.configuration.graphql.client.factory.create(workspaceId, sdm.configuration);

    let pgs = await pendingGoalSets({ graphClient } as any, sdm.configuration.name);
    while (pgs.length > 0) {
        for (const goalSet of pgs) {

            const goals = await fetchGoalsForCommit({ graphClient } as any, {
                owner: goalSet.repo.owner,
                repo: goalSet.repo.name,
                sha: goalSet.sha,
                branch: goalSet.branch,
            } as any, goalSet.repo.providerId, goalSet.goalSetId);

            const state = goalSetState(goals || []);

            if (state !== goalSet.state) {
                const newGoalSet = {
                    ...goalSet,
                    state,
                };

                const messageClient = new TriggeredMessageClient(
                    (sdm.configuration.ws as any).lifecycle,
                    workspaceId,
                    sdm.configuration);
                await messageClient.send(newGoalSet, addressEvent(GoalSetRootType));
            }
        }
        pgs = await pendingGoalSets({ graphClient } as any, sdm.configuration.name);
    }

}

class TriggeredMessageClient extends AbstractWebSocketMessageClient {

    constructor(ws: WebSocketLifecycle,
                workspaceId: string,
                configuration: Configuration) {
        super(ws, {} as any, guid(), { id: workspaceId }, {} as any, configuration);
    }
}
