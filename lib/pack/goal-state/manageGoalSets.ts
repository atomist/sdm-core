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
    AutomationContextAware,
    Configuration,
    configurationValue,
    guid,
    HandlerContext,
    logger,
    QueryNoCacheOptions,
} from "@atomist/automation-client";
import { WebSocketLifecycle } from "@atomist/automation-client/lib/internal/transport/websocket/WebSocketLifecycle";
import { AbstractWebSocketMessageClient } from "@atomist/automation-client/lib/internal/transport/websocket/WebSocketMessageClient";
import * as namespace from "@atomist/automation-client/lib/internal/util/cls";
import {
    fetchGoalsForCommit,
    GoalSetRootType,
    goalSetState,
    SdmGoalState,
    SoftwareDeliveryMachine,
    TriggeredListener,
    updateGoal,
} from "@atomist/sdm";
import * as _ from "lodash";
import { InProcessSdmGoals } from "../../typings/types";
import { formatDuration } from "../../util/misc/time";
import { pendingGoalSets } from "./cancelGoals";
import { GoalStateOptions } from "./goalState";

/**
 * TriggeredListener that queries pending goal sets and updates their state according to state of
 * goals
 */
export function manageGoalSetsTrigger(options?: GoalStateOptions["cancellation"]): TriggeredListener {
    return async li => {
        const workspaceIds = li.sdm.configuration.workspaceIds;
        if (!!workspaceIds && workspaceIds.length > 0) {
            for (const workspaceId of workspaceIds) {
                const ses = namespace.create();
                ses.run(async () => {
                    const id = guid();
                    namespace.set({
                        invocationId: id,
                        correlationId: id,
                        workspaceName: workspaceId,
                        workspaceId,
                        operation: "ManagePendingGoalSets",
                        ts: Date.now(),
                        name: li.sdm.configuration.name,
                        version: li.sdm.configuration.version,
                    });
                    try {
                        const graphClient = li.sdm.configuration.graphql.client.factory.create(workspaceId, li.sdm.configuration);
                        const messageClient = new TriggeredMessageClient(
                            (li.sdm.configuration.ws as any).lifecycle,
                            workspaceId,
                            li.sdm.configuration) as any;
                        const ctx: HandlerContext & AutomationContextAware = {
                            graphClient,
                            messageClient,
                            workspaceId,
                            correlationId: id,
                            invocationId: id,
                            context: {
                                name: li.sdm.configuration.name,
                                version: li.sdm.configuration.version,
                                operation: "ManagePendingGoalSets",
                                ts: Date.now(),
                                workspaceId,
                                workspaceName: workspaceId,
                                correlationId: id,
                                invocationId: id,
                            },
                        } as any;

                        await manageGoalSets(li.sdm, ctx);
                        await timeoutInProcessGoals(li.sdm, ctx, options);
                    } catch (e) {
                        logger.debug("Error managing pending goal sets: %s", e.stack);
                    }
                });
            }
        }
    };
}

export async function manageGoalSets(sdm: SoftwareDeliveryMachine,
                                     ctx: HandlerContext): Promise<void> {

    const pgs = await pendingGoalSets(ctx, sdm.configuration.name, 0, 100);
    for (const goalSet of pgs) {

        const goals = await fetchGoalsForCommit(ctx, {
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

            logger.debug(`Goal set '${goalSet.goalSetId}' now in state '${state}'`);
            await ctx.messageClient.send(newGoalSet, addressEvent(GoalSetRootType));
        }
    }
}

export async function timeoutInProcessGoals(sdm: SoftwareDeliveryMachine,
                                            ctx: HandlerContext,
                                            options?: GoalStateOptions["cancellation"]): Promise<void> {
    const timeout = !!options && !!options.timeout
        ? options.timeout
        : _.get(sdm.configuration, "sdm.goal.inProcessTimeout", 1000 * 60 * 60);
    const end = Date.now() - timeout;

    const gs = (await ctx.graphClient.query<InProcessSdmGoals.Query, InProcessSdmGoals.Variables>({
        name: "InProcessSdmGoals",
        variables: {
            registration: [sdm.configuration.name],
        },
        options: {
            ...QueryNoCacheOptions,
            log: configurationValue("sdm.query.logging", false),
        },
    })).SdmGoal;

    const state = !!options && !!options.state ? options.state : SdmGoalState.canceled;

    for (const goal of gs) {
        if (goal.ts < end) {
            logger.debug(
                `Canceling goal '${goal.uniqueName}' of goal set '${goal.goalSetId}' because it timed out after '${formatDuration(timeout)}'`);
            await updateGoal(
                ctx,
                goal as any,
                {
                    state,
                    description: `${state === SdmGoalState.canceled ? "Canceled" : "Failed"}: ${goal.name}`,
                    phase: `${formatDuration(timeout)} timeout`,
                });
        }
    }
}

class TriggeredMessageClient extends AbstractWebSocketMessageClient {

    constructor(ws: WebSocketLifecycle,
                workspaceId: string,
                configuration: Configuration) {
        super(ws, {} as any, guid(), { id: workspaceId }, {} as any, configuration);
    }
}
