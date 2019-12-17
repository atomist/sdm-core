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
    GoalInvocation,
    GoalScheduler,
    minimalClone,
} from "@atomist/sdm";
import { SdmGoalFulfillmentMethod } from "@atomist/sdm/lib/api/goal/SdmGoalMessage";
import * as _ from "lodash";
import {
    Container,
    ContainerRegistration,
} from "../../goal/container/container";

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

    constructor(private readonly options: KubernetesFulfillmentOptions = {
                    registration: "@atomist/k8s-sdm",
                    name: "container-deploy",
                }) {
    }

    public async schedule(gi: GoalInvocation): Promise<ExecuteGoalResult> {
        const { goalEvent, goal, configuration } = gi;

        goalEvent.fulfillment.registration =
            typeof this.options.registration === "string" ? this.options.registration : await this.options.registration(gi);
        goalEvent.fulfillment.name =
            typeof this.options.name === "string" ? this.options.name : await this.options.name(gi);
        goalEvent.fulfillment.method = SdmGoalFulfillmentMethod.Sdm;

        let registration = _.cloneDeep((goal as Container).registrations[0] as ContainerRegistration);

        if (registration.callback) {
            registration = await configuration.sdm.projectLoader.doWithProject({
                ...gi,
                readOnly: true,
                cloneOptions: minimalClone(goalEvent.push, { detachHead: true }),
            }, async p => {
                return {
                    ...registration,
                    ...(await registration.callback(_.cloneDeep(registration), p, goal as Container, goalEvent, gi)) || {},
                };
            });
        }

        const data: any = JSON.parse(goalEvent.data || "{}");
        const newData: any = {};
        delete registration.callback;
        _.set<any>(newData, "@atomist/sdm/container", registration);

        goalEvent.data = JSON.stringify(_.merge(data, newData));

        return Success;
    }

    public async supports(gi: GoalInvocation): Promise<boolean> {
        const { goal } = gi;
        return goal instanceof Container;
    }
}
