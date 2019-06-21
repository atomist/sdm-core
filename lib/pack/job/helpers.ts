
import {
    CommandInvocation,
    HandlerContext,
    MessageOptions,
    ParameterType,
    SourceDestination,
} from "@atomist/automation-client";
import {
    isCommandIncoming,
    isEventIncoming,
} from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { CommandHandlerMetadata } from "@atomist/automation-client/lib/metadata/automationMetadata";

/**
 * Prepare the CommandInvocation instance to be sent for execution
 *
 * This pieces apart provided values form the parameters into the command's parameter, mapped parameter
 * and secret structures.
 */
export function prepareCommandInvocation(md: CommandHandlerMetadata, parameters: ParameterType = {}): CommandInvocation {
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
export function prepareHandlerContext(ctx: HandlerContext, trigger: any): HandlerContext {
    if (isCommandIncoming(trigger)) {
        const source = trigger.source;
        if (!!source) {
            ctx.messageClient.respond = (msg: any, options?: MessageOptions) => {
                return ctx.messageClient.send(msg, new SourceDestination(source, source.user_agent), options);
            };
        }
    } else if (isEventIncoming(trigger)) {
        ctx.messageClient.respond = async () => {
            return;
        }
    }
    return ctx;
}
