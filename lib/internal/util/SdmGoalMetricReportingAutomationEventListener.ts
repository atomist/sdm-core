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
    AutomationClient,
    AutomationEventListenerSupport,
    EventIncoming,
} from "@atomist/automation-client";
import * as cluster from "cluster";
import { StatsD } from "hot-shots";
import * as _ from "lodash";

/**
 * Automation listener that reports goal round trip metrics to StatsD.
 */
export class SdmGoalMetricReportingAutomationEventListener extends AutomationEventListenerSupport {

    private statsd: StatsD;

    public async startupSuccessful(client: AutomationClient): Promise<void> {
        if (cluster.isMaster && client.configuration.statsd.enabled) {
            this.statsd = (client.configuration.statsd as any).__instance;
        }
    }

    public eventIncoming(payload: EventIncoming): void {
        if (cluster.isMaster && !!this.statsd && process.env.ATOMIST_ISOLATED_GOAL !== "forked") {
            const ts = _.get(payload.data, "SdmGoal[0].ts");
            const name = _.get(payload.data, "SdmGoal[0].name");
            if (!!name) {
                this.statsd.increment(
                    `counter.goal`,
                    1,
                    [`atomist_goal:${name}`],
                    () => { /* intentionally left empty */
                    });
            }
            if (ts) {
                this.statsd.timing(
                    "timer.goal.round_trip",
                    Date.now() - ts,
                    1,
                    {},
                    () => { /* intentionally left empty */
                    });
            }
        }
    }
}
