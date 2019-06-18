import {
    AutomationContextAware,
    AutomationEventListenerSupport,
    CommandIncoming,
    HandlerContext,
    MessageOptions,
    SourceDestination,
} from "@atomist/automation-client";
import { isCommandIncoming } from "@atomist/automation-client/lib/internal/transport/RequestProcessor";

/**
 * Enable support for response messages from Job Task executions that
 * start from an event handler invocation
 */
export class JobResponseEnablingAutomationEventListener extends AutomationEventListenerSupport {

    public contextCreated(context: HandlerContext): void {
        const atx = context as any as AutomationContextAware;
        if (atx.context.operation === "OnAnyJobTask" && isCommandIncoming(atx.trigger)) {
            const source = (atx.trigger as CommandIncoming).source;
            context.messageClient.respond = (msg: any, options?: MessageOptions) => {
                return context.messageClient.send(msg, new SourceDestination(source, source.user_agent), options);
            };
        }
    }

}
