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
    automationClientInstance,
    EventFired,
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    QueryNoCacheOptions,
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
    GoalScheduler,
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
import {
    CanceledSdmGoal,
    OnAnyRequestedSdmGoal,
} from "../../../../typings/types";
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
            logger.debug(`Goal ${sdmGoal.uniqueName} skipped because not relevant for this SDM`);
            return Success;
        }

        // Validate that goal hasn't been canceled in the meantime
        const goalCanceled = await ctx.graphClient.query<CanceledSdmGoal.Query, CanceledSdmGoal.Variables>({
            name: "CanceledSdmGoal",
            variables: {
                goalSetId: sdmGoal.goalSetId,
                uniqueName: sdmGoal.uniqueName,
            },
            options: QueryNoCacheOptions,
        });

        if (goalCanceled && goalCanceled.SdmGoal && goalCanceled.SdmGoal.length > 0) {
            logger.info(`Goal ${sdmGoal.uniqueName} has been canceled. Not fulfilling`);
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
                    description: `No fulfillment for ${sdmGoal.uniqueName}`,
                });
            return Success;
        }

        const id = this.configuration.sdm.repoRefResolver.repoRefFromSdmGoal(sdmGoal);
        const credentials = this.configuration.sdm.credentialsResolver.eventHandlerCredentials(ctx, id);
        const addressChannels = addressChannelsFor(sdmGoal.push.repo, ctx);
        const preferences = this.configuration.sdm.preferenceStoreFactory(ctx);

        const implementation = this.implementationMapper.findImplementationBySdmGoal(sdmGoal);
        const { goal } = implementation;

        const progressLog = new WriteToAllProgressLog(
            sdmGoal.name,
            new LoggingProgressLog(sdmGoal.name, "debug"),
            await this.configuration.sdm.logFactory(ctx, sdmGoal));

        const goalInvocation: GoalInvocation = {
            configuration: this.configuration,
            sdmGoal,
            goalEvent: sdmGoal,
            goal,
            progressLog,
            context: ctx,
            addressChannels,
            preferences,
            id,
            credentials,
        };

        const goalScheduler = await findGoalScheduler(goalInvocation, this.configuration);
        if (!!goalScheduler) {
            const start = Date.now();
            const result = await goalScheduler.schedule(goalInvocation);
            if (!!result && result.code !== 0) {
                await updateGoal(ctx, sdmGoal, {
                    state: SdmGoalState.failure,
                    description: `Failed to schedule goal`,
                    url: progressLog.url,
                });
                await reportEndAndClose(result, start, progressLog);
            }
            return {
                code: 0,
                ...result as any,
            };
        } else {
            delete (sdmGoal as any).id;

            await reportStart(sdmGoal, progressLog);
            const start = Date.now();

            const result = await executeGoal(
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
            return {
                code: 0,
                ...result,
            };
        }
    }
}

async function findGoalScheduler(gi: GoalInvocation,
                                 configuration: SoftwareDeliveryMachineConfiguration): Promise<GoalScheduler | undefined> {
    let goalSchedulers: GoalScheduler[];
    if (!configuration.sdm.goalLauncher) {
        return undefined;
    } else if (!Array.isArray(configuration.sdm.goalLauncher)) {
        goalSchedulers = [configuration.sdm.goalLauncher];
    } else {
        goalSchedulers = configuration.sdm.goalLauncher;
    }
    for (const gl of goalSchedulers) {
        if (await gl.supports(gi)) {
            return gl;
        }
    }
    return undefined;
}

async function reportStart(sdmGoal: SdmGoalEvent, progressLog: ProgressLog) {
    progressLog.write(`/--`);
    progressLog.write(`Repository: ${sdmGoal.push.repo.owner}/${sdmGoal.push.repo.name}/${sdmGoal.branch}`);
    progressLog.write(`Sha: ${sdmGoal.sha}`);
    progressLog.write(`Goal: ${sdmGoal.name} (${sdmGoal.uniqueName})`);
    progressLog.write(`Environment: ${sdmGoal.environment.slice(2)}`);
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
