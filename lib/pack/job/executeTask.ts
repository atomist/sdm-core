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
    OnEvent,
    ParameterType,
    SourceDestination,
    Success,
} from "@atomist/automation-client";
import { isCommandIncoming } from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { CommandHandlerMetadata } from "@atomist/automation-client/lib/metadata/automationMetadata";
import { redact } from "@atomist/automation-client/lib/util/redact";
import {
    EventHandlerRegistration,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import {
    AtmJobTaskState,
    OnAnyJobTask,
    SetJobTaskState,
} from "../../typings/types";
import {
    JobTask,
    JobTaskType,
} from "./createJob";

/**
 * Execute an incoming job task event
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
        listener: ExecuteTaskListener,
    };
}

export const ExecuteTaskListener: OnEvent<OnAnyJobTask.Subscription> = async (e, ctx) => {
    const task = e.data.AtmJobTask[0];

    if (task.state === AtmJobTaskState.created) {
        let jobData: any;
        let taskData: JobTask<any>;

        try {
            jobData = JSON.parse(task.job.data);
            taskData = JSON.parse(task.data) as JobTask<any>;
        } catch (e) {
            logger.warn("Parsing of job or task data failed: %s", e.message);
            await updateJobTaskState(
                task.id,
                AtmJobTaskState.failed,
                redact(`Task command '${task.name}' failed: ${e.message}`),
                ctx);
        }

        if (taskData.type === JobTaskType.Command) {
            const md = automationClientInstance().automationServer.automations.commands
                .find(c => c.name === task.name);

            if (!md) {
                await updateJobTaskState(
                    task.id,
                    AtmJobTaskState.failed,
                    `Task command '${task.name}' could not be found`,
                    ctx);
            } else {
                try {
                    // Invoke the command
                    const result = await automationClientInstance().automationServer.invokeCommand(
                        prepareCommandInvocation(md, taskData.parameters),
                        prepareHandlerContext(ctx, jobData),
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
                                redact(result.message || `Task command '${task.name}' failed`),
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
                        redact(`Task command '${task.name}' failed: ${e.message}`),
                        ctx);
                }
            }
        }
    }

    return Success;
};

/**
 * Update the job task status
 */
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

/**
 * Prepare the CommandInvocation instance to be sent for execution
 *
 * This pieces apart provided values form the parameters into the command's parameter, mapped parameter
 * and secret structures.
 */
function prepareCommandInvocation(md: CommandHandlerMetadata, parameters: ParameterType = {}): CommandInvocation {
    const ci: CommandInvocation = {
        name: md.name,
        args: md.parameters.filter(p => !!parameters[p.name]).map(p => ({
            name: p.name,
            value: parameters[p.name] as any,
        })),
        mappedParameters: md.mapped_parameters.filter(p => !!parameters[p.name]).map(p => ({
            name: p.name,
            value: parameters[p.name] as any,
        })),
        secrets: md.secrets.map(p => ({
            uri: p.uri,
            value: parameters[p.name] as any || "null",
        })),
    };
    return ci;
}

/**
 * Decorate the HandlerContext to support response messages for this event handler invocation.
 *
 * Task execution happens is rooted in an event handler executing; this would prevent response
 * messages to work out of the box which is why this function adds the respond function to the
 * MessageClient if possible.
 */
function prepareHandlerContext(ctx: HandlerContext, trigger: any): HandlerContext {
    if (isCommandIncoming(trigger)) {
        const source = trigger.source;
        if (!!source) {
            ctx.messageClient.respond = (msg: any, options?: MessageOptions) => {
                return ctx.messageClient.send(msg, new SourceDestination(source, source.user_agent), options);
            };
        }
    }
    return ctx;
}
