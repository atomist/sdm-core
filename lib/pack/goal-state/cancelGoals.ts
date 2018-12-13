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
    addressEvent,
    HandlerContext,
    QueryNoCacheOptions,
} from "@atomist/automation-client";
import {
    CommandHandlerRegistration,
    fetchGoalsForCommit,
    GoalSetRootType,
    InProcessSdmGoalSets,
    slackInfoMessage,
    slackSuccessMessage,
    SoftwareDeliveryMachine,
    updateGoal,
} from "@atomist/sdm";
import {
    bold,
    codeLine,
    italic,
} from "@atomist/slack-messages";
import {
    SdmGoalSetForId,
    SdmGoalState,
} from "../../typings/types";

/**
 * Cancel one or all pending goal sets
 * @param sdm
 */
export function cancelGoalSetsCommand(sdm: SoftwareDeliveryMachine): CommandHandlerRegistration<{ goalSetId: string }> {
    return {
        name: "CancelGoalSets",
        description: "Cancel one or all pending goal sets of this SDM",
        intent: `cancel goal sets ${sdm.configuration.name.replace("@", "")}`,
        parameters: { goalSetId: { required: false, description: "ID of the goal set to cancel" } },
        listener: async ci => {
            if (!!ci.parameters.goalSetId) {
                await cancelGoalSet(ci.parameters.goalSetId, ci.context);
            } else {
                let pgs = await pendingGoalSets(ci.context, sdm.configuration.name);
                let count = 0;
                while (pgs.length > 0) {
                    for (const pg of pgs) {
                        await cancelGoalSet(pg, ci.context);
                        count++;
                    }
                    pgs = await pendingGoalSets(ci.context, sdm.configuration.name);
                }
                await ci.context.messageClient.respond(
                    slackSuccessMessage(
                        "Cancel Goal Sets",
                        `Successfully canceled ${count} pending goal ${count > 1 ? "sets" : "set"}`));
            }
        },
    };
}

async function pendingGoalSets(ctx: HandlerContext, name: string): Promise<string[]> {
    const results = await ctx.graphClient.query<InProcessSdmGoalSets.Query, InProcessSdmGoalSets.Variables>({
        name: "InProcessSdmGoalSets",
        variables: {
            fetch: 50,
            registration: [name],
        },
        options: QueryNoCacheOptions,
    });
    return (results.SdmGoalSet || []).map(gs => gs.goalSetId);
}

async function cancelGoalSet(goalSetId: string, ctx: HandlerContext): Promise<void> {
    const result = await ctx.graphClient.query<SdmGoalSetForId.Query, SdmGoalSetForId.Variables>({
        name: "SdmGoalSetForId",
        variables: {
            goalSetId: [goalSetId],
        },
        options: QueryNoCacheOptions,
    });

    const goalSet = result.SdmGoalSet[0];

    const goals = await fetchGoalsForCommit(ctx, {
        owner: goalSet.repo.owner,
        repo: goalSet.repo.name,
        sha: goalSet.sha,
        branch: goalSet.branch,
    } as any, goalSet.repo.providerId, goalSetId);

    for (const goal of goals) {
        if (![SdmGoalState.success,
            SdmGoalState.canceled,
            SdmGoalState.stopped,
            SdmGoalState.skipped,
            SdmGoalState.failure].includes(goal.state)) {
            await updateGoal(ctx, goal, {
                state: SdmGoalState.canceled,
                description: `Canceled ${goal.name}`,
            });
        }
    }

    if (result && result.SdmGoalSet && result.SdmGoalSet.length === 1) {
        const goalSet = result.SdmGoalSet[0];
        const newGoalSet = {
            ...goalSet,
            state: SdmGoalState.canceled,
        };
        await ctx.messageClient.send(newGoalSet, addressEvent(GoalSetRootType));
    }

    await ctx.messageClient.respond(
        slackInfoMessage(
            "Cancel Goal Set",
            `Canceled goal set ${italic(goalSet.goalSet)} ${codeLine(goalSetId.slice(0, 7))} on ${
                codeLine(goalSet.sha.slice(0, 7))} of ${bold(`${goalSet.repo.owner}/${goalSet.repo.name}/${goalSet.branch}`)}`));
}