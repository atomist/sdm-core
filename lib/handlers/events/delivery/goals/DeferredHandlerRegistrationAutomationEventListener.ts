import {
    automationClientInstance,
    AutomationEventListenerSupport,
    EventIncoming,
    Maker,
    RequestProcessor,
} from "@atomist/automation-client";
import { HandleCommand } from "@atomist/automation-client/lib/HandleCommand";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import * as cluster from "cluster";

export class DeferredHandlerRegistrationAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly eventHandlers: Array<Maker<HandleEvent<any>>> = [],
                private readonly commandHandlers: Array<Maker<HandleCommand>> = []) {
        super();
    }

    public eventIncoming(payload: EventIncoming) {
        if (cluster.isWorker) {
            this.eventHandlers.forEach(eh => automationClientInstance().withEventHandler(eh));
            this.commandHandlers.forEach(eh => automationClientInstance().withCommandHandler(eh));
        }
    }

    public async registrationSuccessful(eventHandler: RequestProcessor) {
        if (cluster.isMaster) {
            this.eventHandlers.forEach(eh => automationClientInstance().withEventHandler(eh));
            this.commandHandlers.forEach(eh => automationClientInstance().withCommandHandler(eh));
        }
    }
}