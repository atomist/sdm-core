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
    EventHandler,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import { subscription } from "@atomist/automation-client/graph/graphQL";
import {
    GoalExecutionListener,
    GoalInvocation,
    PushListenerInvocation,
} from "@atomist/sdm";
import { executeGoal } from "@atomist/sdm/api-helper/goal/executeGoal";
import { LoggingProgressLog } from "@atomist/sdm/api-helper/log/LoggingProgressLog";
import { WriteToAllProgressLog } from "@atomist/sdm/api-helper/log/WriteToAllProgressLog";
import { addressChannelsFor } from "@atomist/sdm/api/context/addressChannels";
import { SdmGoalEvent } from "@atomist/sdm/api/goal/SdmGoalEvent";
import { SdmGoalImplementationMapper } from "@atomist/sdm/api/goal/support/SdmGoalImplementationMapper";
import { CredentialsResolver } from "@atomist/sdm/spi/credentials/CredentialsResolver";
import {
    ProgressLog,
    ProgressLogFactory,
} from "@atomist/sdm/spi/log/ProgressLog";
import { ProjectLoader } from "@atomist/sdm/spi/project/ProjectLoader";
import { RepoRefResolver } from "@atomist/sdm/spi/repo-ref/RepoRefResolver";
import { OnAnyRequestedSdmGoal } from "@atomist/sdm/typings/types";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import { serializeResult } from "../../../../util/misc/result";
import { formatDuration } from "../../../../util/misc/time";

/**
 * Handle an SDM request goal. Used for many implementation types.
 */
@EventHandler("Fulfill a goal when it reaches 'requested' state",
    subscription("OnAnyRequestedSdmGoal"))
export class FulfillGoalOnRequested implements HandleEvent<OnAnyRequestedSdmGoal.Subscription> {

    constructor(private readonly implementationMapper: SdmGoalImplementationMapper,
                private readonly projectLoader: ProjectLoader,
                private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsResolver: CredentialsResolver,
                private readonly logFactory: ProgressLogFactory,
                private readonly goalExecutionListeners: GoalExecutionListener[]) {
    }

    public async handle(event: EventFired<OnAnyRequestedSdmGoal.Subscription>,
                        ctx: HandlerContext,
                        params: this): Promise<HandlerResult> {
        const sdmGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        if (sdmGoal.fulfillment.method !== "SDM fulfill on requested") {
            logger.info("Goal %s: Implementation method is '%s'; not fulfilling", sdmGoal.name, sdmGoal.fulfillment.method);
            return Success;
        }

        const id = params.repoRefResolver.repoRefFromSdmGoal(sdmGoal);
        const credentials = this.credentialsResolver.eventHandlerCredentials(ctx, id);
        const addressChannels = addressChannelsFor(sdmGoal.push.repo, ctx);

        return this.projectLoader.doWithProject({ credentials, id, context: ctx, readOnly: true }, async project => {

            const pli: PushListenerInvocation = {
                project,
                credentials,
                id,
                push: sdmGoal.push,
                context: ctx,
                addressChannels,
            };

            const { goal, goalExecutor, logInterpreter, progressReporter } =
                await this.implementationMapper.findImplementationBySdmGoal(sdmGoal, pli);

            const progressLog = new WriteToAllProgressLog(
                sdmGoal.name,
                new LoggingProgressLog(sdmGoal.name, "debug"),
                await this.logFactory(ctx, sdmGoal));

            const goalInvocation: GoalInvocation = {
                sdmGoal,
                progressLog,
                context: ctx,
                addressChannels,
                id,
                credentials,
            };

            const isolatedGoalLauncher = this.implementationMapper.getIsolatedGoalLauncher();

            if (goal.definition.isolated && !process.env.ATOMIST_ISOLATED_GOAL && isolatedGoalLauncher) {
                const result = isolatedGoalLauncher(sdmGoal, ctx, progressLog);
                await progressLog.close();
                return result;
            } else {
                delete (sdmGoal as any).id;

                await reportStart(sdmGoal, progressLog);
                const start = Date.now();

                return executeGoal(
                    { projectLoader: params.projectLoader, goalExecutionListeners: this.goalExecutionListeners },
                    goalExecutor,
                    goalInvocation,
                    sdmGoal,
                    goal,
                    logInterpreter,
                    progressReporter)
                    .then(async res => {
                        await reportEndAndClose(res, start, progressLog);
                        return res;
                    }, async err => {
                        await reportEndAndClose(err, start, progressLog);
                        throw err;
                    });
            }
        });
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
