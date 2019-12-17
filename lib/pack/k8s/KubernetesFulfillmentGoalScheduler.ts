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

import { Success } from "@atomist/automation-client";
import {
    ExecuteGoalResult,
    GoalImplementationMapper,
    GoalInvocation,
    GoalScheduler,
} from "@atomist/sdm";
import { SdmGoalFulfillmentMethod } from "@atomist/sdm/lib/api/goal/SdmGoalMessage";
import { Container } from "../../goal/container/container";

export interface KubernetesFulfillmentOptions {
    registration?: string | ((gi: GoalInvocation) => Promise<string>);
    name?: string | ((gi: GoalInvocation) => Promise<string>);
}

/**
 * GoalScheduler implementation that redirects goals to a registered k8s-sdm for
 * fulfillment.
 *
 * This is useful in runtimes that don't support launching container goals such as
 * FaaS environments like Google Cloud Functions.
 */
export class KubernetesFulfillmentGoalScheduler implements GoalScheduler {

    constructor(private readonly implementationMapper: GoalImplementationMapper,
                private readonly options: KubernetesFulfillmentOptions = {
                    registration: "@atomist/k8s-sdm",
                    name: "container-deploy",
                }) {
    }

    public async schedule(gi: GoalInvocation): Promise<ExecuteGoalResult> {
        const { goalEvent } = gi;
        // Run the FulfillmentCallback because it wasn't being run as part of the goal lifecycle
        // before
        const cbs = this.implementationMapper.findFulfillmentCallbackForGoal(goalEvent);
        for (const cb of cbs) {
            await cb.callback(goalEvent, gi);
        }

        goalEvent.fulfillment.registration =
            typeof this.options.registration === "string" ? this.options.registration : await this.options.registration(gi);
        goalEvent.fulfillment.name =
            typeof this.options.name === "string" ? this.options.name : await this.options.name(gi);
        goalEvent.fulfillment.method = SdmGoalFulfillmentMethod.Sdm;

        return Success;
    }

    public async supports(gi: GoalInvocation): Promise<boolean> {
        const { goal } = gi;
        return goal instanceof Container;
    }
}
