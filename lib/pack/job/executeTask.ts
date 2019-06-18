import {
    automationClientInstance,
    AutomationContextAware,
    GraphQL,
    HandlerResult,
    Success,
} from "@atomist/automation-client";
import {
    isCommandIncoming,
    isEventIncoming,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { Deferred } from "@atomist/automation-client/lib/internal/util/Deferred";
import {
    EventHandlerRegistration,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import {
    AtmJobTaskState,
    OnAnyJobTask,
    SetJobTaskState,
} from "../../typings/types";

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

                const trigger = JSON.parse(task.data);
                trigger.__context = (ctx as any as AutomationContextAware).context;

                const deferred = new Deferred<HandlerResult>();
                if (isCommandIncoming(trigger)) {
                    automationClientInstance().processCommand(trigger, async r => {
                        const res = await r;
                        await ctx.graphClient.mutate<SetJobTaskState.Mutation, SetJobTaskState.Variables>({
                            name: "SetJobTaskState",
                            variables: {
                                id: task.id,
                                state: {
                                    state: res.code === 0 ? AtmJobTaskState.success : AtmJobTaskState.failed,
                                    message: res.message,
                                },
                            },
                        });
                        deferred.resolve(res);
                    });
                } else if (isEventIncoming(trigger)) {
                    automationClientInstance().processEvent(trigger, async r => {
                        const results = await r;
                        const res = {
                            code: results.some(sr => sr.code !== 0) ? 1 : 0,
                            message: results.map(sr => sr.message).join(", "),
                        };
                        await ctx.graphClient.mutate<SetJobTaskState.Mutation, SetJobTaskState.Variables>({
                            name: "SetJobTaskState",
                            variables: {
                                id: task.id,
                                state: {
                                    state: res.code === 0 ? AtmJobTaskState.success : AtmJobTaskState.failed,
                                    message: res.message,
                                },
                            },
                        });
                    });
                }
                return deferred.promise;
            }

            return Success;
        },
    };
}
