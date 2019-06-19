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
    CommandInvocation,
    GraphQL,
    HandlerContext,
    logger,
    MessageOptions,
    SourceDestination,
    Success,
} from "@atomist/automation-client";
import { isCommandIncoming } from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
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
                const parameters = data.parameters;

                const md = automationClientInstance().automationServer.automations.commands.find(c => c.name === task.name);
                if (!md) {
                    await updateJobTaskState(
                        task.id,
                        AtmJobTaskState.failed,
                        `Task command '${task.name}' could not be found`,
                        ctx);
                } else {
                    // Prepare the command
                    const ci: CommandInvocation = {
                        name: md.name,
                        args: md.parameters.filter(p => !!parameters[p.name]).map(p => ({
                            name: p.name,
                            value: parameters[p.name],
                        })),
                        mappedParameters: md.mapped_parameters.filter(p => !!parameters[p.name]).map(p => ({
                            name: p.name,
                            value: parameters[p.name],
                        })),
                        secrets: md.secrets.filter(p => !!parameters[p.name]).map(p => ({
                            uri: p.uri,
                            value: parameters[p.name],
                        })),
                    };

                    // Invoke the command
                    try {
                        const result = await automationClientInstance().automationServer.invokeCommand(
                            ci,
                            prepareForResponseMessages(ctx, jobData),
                        );

                        // Handle result
                        if (!!result && result.code !== undefined) {
                            if (result.code === 0) {
                                await updateJobTaskState(
                                    task.id,
                                    AtmJobTaskState.success,
                                    `Task command '${task.name}' successfully executed`,
                                    ctx);
                            } else {
                                await updateJobTaskState(
                                    task.id,
                                    AtmJobTaskState.failed,
                                    result.message || `Task command '${task.name}' failed`,
                                    ctx);
                            }
                        } else {
                            await updateJobTaskState(
                                task.id,
                                AtmJobTaskState.success,
                                `Task command '${task.name}' successfully executed`,
                                ctx);
                        }
                    } catch (e) {
                        logger.warn("Command execution failed: %s", e.message);
                        await updateJobTaskState(
                            task.id,
                            AtmJobTaskState.failed,
                            `Task command '${task.name}' failed`,
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
