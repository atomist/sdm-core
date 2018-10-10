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
    automationClientInstance,
    EventFired,
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
    Value,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    addressChannelsFor,
    executeGoal,
    GoalExecutionListener,
    GoalImplementationMapper,
    GoalInvocation,
    LoggingProgressLog,
    ProgressLog,
    SdmGoalEvent,
    SdmGoalFulfillmentMethod,
    SdmGoalState,
    serializeResult,
    SoftwareDeliveryMachineConfiguration,
    updateGoal,
    WriteToAllProgressLog,
} from "@atomist/sdm";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { OnAnyRequestedSdmGoal } from "../../../../typings/types";
import { formatDuration } from "../../../../util/misc/time";

/**
 * Handle an SDM request goal. Used for many implementation types.
 */
@EventHandler("Fulfill a goal when it reaches 'requested' state",
    GraphQL.subscription("OnAnyRequestedSdmGoal"))
export class FulfillGoalOnRequested implements HandleEvent<OnAnyRequestedSdmGoal.Subscription> {

    @Value("") // empty path returns the entire configuration
    public configuration: SoftwareDeliveryMachineConfiguration;

    constructor(private readonly implementationMapper: GoalImplementationMapper,
                private readonly goalExecutionListeners: GoalExecutionListener[]) {
    }

    public async handle(event: EventFired<OnAnyRequestedSdmGoal.Subscription>,
                        ctx: HandlerContext): Promise<HandlerResult> {
        const sdmGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        if (sdmGoal.fulfillment.method === SdmGoalFulfillmentMethod.SideEffect) {
            logger.info("No fulfilling side-effected goal '%s' with method '%s/%s'",
                sdmGoal.uniqueName, sdmGoal.fulfillment.method, sdmGoal.fulfillment.name);
            return Success;
        } else if (sdmGoal.fulfillment.method === SdmGoalFulfillmentMethod.Other) {
            // fail goal with neither Sdm nor SideEffect fulfillment
            await updateGoal(
                ctx,
                sdmGoal,
                {
                    state: SdmGoalState.failure,
                    description: `No fulfillment for ${sdmGoal.name}`,
                });
            return Success;
        }

        const id = this.configuration.sdm.repoRefResolver.repoRefFromSdmGoal(sdmGoal);
        const credentials = this.configuration.sdm.credentialsResolver.eventHandlerCredentials(ctx, id);
        const addressChannels = addressChannelsFor(sdmGoal.push.repo, ctx);

        const implementation = this.implementationMapper.findImplementationBySdmGoal(sdmGoal);
        const { goal } = implementation;

        const progressLog = new WriteToAllProgressLog(
            sdmGoal.name,
            new LoggingProgressLog(sdmGoal.name, "debug"),
            await this.configuration.sdm.logFactory(ctx, sdmGoal));

        const goalInvocation: GoalInvocation = {
            configuration: this.configuration,
            sdmGoal,
            goal,
            progressLog,
            context: ctx,
            addressChannels,
            id,
            credentials,
        };

        const isolatedGoalLauncher = this.configuration.sdm.goalLauncher;

        if (goal.definition.isolated && !process.env.ATOMIST_ISOLATED_GOAL && isolatedGoalLauncher) {
            const result = isolatedGoalLauncher(sdmGoal, ctx, progressLog);
            await progressLog.close();
            return result;
        } else {
            delete (sdmGoal as any).id;

            await reportStart(sdmGoal, progressLog);
            const start = Date.now();

            return executeGoal(
                {
                    projectLoader: this.configuration.sdm.projectLoader,
                    goalExecutionListeners: this.goalExecutionListeners,
                },
                implementation,
                goalInvocation)
                .then(async res => {
                    await reportEndAndClose(res, start, progressLog);
                    return res;
                }, async err => {
                    await reportEndAndClose(err, start, progressLog);
                    throw err;
                });
        }
    }
}

async function reportStart(sdmGoal: SdmGoalEvent, progressLog: ProgressLog) {
    progressLog.write(`/--`);
    progressLog.write(`Repository: ${sdmGoal.push.repo.owner}/${sdmGoal.push.repo.name}/${sdmGoal.branch}`);
    progressLog.write(`Sha: ${sdmGoal.sha}`);
    progressLog.write(`Goal: ${sdmGoal.name} - ${sdmGoal.environment.slice(2)}`);
    progressLog.write(`GoalSet: ${sdmGoal.goalSet} - ${sdmGoal.goalSetId}`);
    progressLog.write(
        `SDM: ${automationClientInstance().configuration.name}:${automationClientInstance().configuration.version}`);
    progressLog.write("\\--");
    await progressLog.flush();
}

async function reportEndAndClose(result: any, start: number, progressLog: ProgressLog) {
    progressLog.write(`/--`);
    progressLog.write(`Result: ${serializeResult(result)}`);
    progressLog.write(`Duration: ${formatDuration(Date.now() - start)}`);
    progressLog.write("\\--");
    await progressLog.close();
}
