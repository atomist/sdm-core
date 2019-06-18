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
    AutomationContextAware,
    AutomationEventListenerSupport,
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
            const source = (atx.trigger).source;
            context.messageClient.respond = (msg: any, options?: MessageOptions) => {
                return context.messageClient.send(msg, new SourceDestination(source, source.user_agent), options);
            };
        }
    }

}
