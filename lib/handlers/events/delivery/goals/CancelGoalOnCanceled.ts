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
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import { ClusterWorkerRequestProcessor } from "@atomist/automation-client/lib/internal/transport/cluster/ClusterWorkerRequestProcessor";
import * as cluster from "cluster";
import { OnSpecificCanceledSdmGoal } from "../../../../typings/types";

@EventHandler("Cancel the currently executing goal",
    GraphQL.subscription({
        name: "OnSpecificCanceledSdmGoal",
        variables: {
            goalSetId: process.env.ATOMIST_GOAL_SET_ID || "n/a",
            uniqueName: process.env.ATOMIST_GOAL_UNIQUE_NAME || "n/a",
        },
    }))
export class CancelGoalOnCanceled implements HandleEvent<OnSpecificCanceledSdmGoal.Subscription> {

    public async handle(e: EventFired<OnSpecificCanceledSdmGoal.Subscription>,
                        ctx: HandlerContext): Promise<HandlerResult> {
        logger.info("Exciting this process because goal was canceled");

        // Exit with 0 to make sure k8 doesn't re-schedule this pod
        if (cluster.isWorker) {
            (automationClientInstance().webSocketHandler as ClusterWorkerRequestProcessor).sendShutdown(0, ctx as any);
        } else {
            automationClientInstance().configuration.ws.termination.graceful = false;
            process.exit(0);
        }

        return Success;
    }
}
