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
    GraphQL,
    HandlerContext,
    logger,
    MessageOptions,
    SourceDestination,
    Success,
} from "@atomist/automation-client";
import { metadataFromInstance } from "@atomist/automation-client/lib/internal/metadata/metadataReading";
import { isCommandIncoming } from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { toFactory } from "@atomist/automation-client/lib/util/constructionUtils";
import {
    EventHandlerRegistration,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import {
    AtmJobTaskState,
    OnAnyJobTask,
    SetJobTaskState,
} from "../../typings/types";
import { JobTask } from "./createJob";

/**
 * Execute an incoming job task
 */
export function executeTask(sdm: SoftwareDeliveryMachine): EventHandlerRegistration<OnAnyJobTask.Subscription> {
    return {
        name: "ExecuteTask",
        description: "Execute a job task",
        subscription: GraphQL.subscription({
            name: "OnAnyJobTask",
            variables: {
                registration: sdm.configuration.name,
            },
        }),
        listener: async (e, ctx) => {
            const task = e.data.AtmJobTask[0];
            if (task.state === AtmJobTaskState.created) {
                const jobData = JSON.parse(task.job.data);
                const data = JSON.parse(task.data) as JobTask<any>;

                const maker = sdm.commandHandlers.find(ch => {
                    const md = metadataFromInstance(toFactory(ch)());
                    return md.name = data.name;
                });

                if (!maker) {
                    await updateJobTaskState(
                        task.id,
                        AtmJobTaskState.failed,
                        `Task command '${data.name}' could not be found`,
                        ctx);
                } else {
                    // Invoke the command
                    try {
                        const handle = toFactory(maker)();
                        const result = await handle.handle(prepareForResponseMessages(ctx, jobData), data.parameters);

                        // Handle result
                        if (!!result && result.code !== undefined) {
                            if (result.code === 0) {
                                await updateJobTaskState(
                                    task.id,
                                    AtmJobTaskState.success,
                                    `Task command '${data.name}' successfully executed`,
                                    ctx);
                            } else {
                                await updateJobTaskState(
                                    task.id,
                                    AtmJobTaskState.failed,
                                    result.message || `Task command '${data.name}' failed`,
                                    ctx);
                            }
                        } else {
                            await updateJobTaskState(
                                task.id,
                                AtmJobTaskState.success,
                                `Task command '${data.name}' successfully executed`,
                                ctx);
                        }
                    } catch (e) {
                        logger.warn("Command execution failed: %s", e.message);
                        await updateJobTaskState(
                            task.id,
                            AtmJobTaskState.failed,
                            `Task command '${data.name}' failed`,
                            ctx);
                    }
                }
            }

            return Success;
        },
    };
}

async function updateJobTaskState(id: string,
                                  state: AtmJobTaskState,
                                  message: string,
                                  ctx: HandlerContext): Promise<void> {
    await ctx.graphClient.mutate<SetJobTaskState.Mutation, SetJobTaskState.Variables>({
        name: "SetJobTaskState",
        variables: {
            id,
            state: {
                state,
                message,
            },
        },
    });
}

function prepareForResponseMessages(ctx: HandlerContext, trigger: any): HandlerContext {
    if (isCommandIncoming(trigger)) {
        const source = trigger.source;
        ctx.messageClient.respond = (msg: any, options?: MessageOptions) => {
            return ctx.messageClient.send(msg, new SourceDestination(source, source.user_agent), options);
        };
    }
    return ctx;
}
