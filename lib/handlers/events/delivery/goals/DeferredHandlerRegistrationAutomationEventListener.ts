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
