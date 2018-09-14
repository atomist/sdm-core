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

import { HandlerContext } from "@atomist/automation-client";
import {
    ProgressLog,
    SdmGoalEvent,
} from "@atomist/sdm";
import { RolarProgressLog } from "./RolarProgressLog";

/**
 * Persistent Rolar log that displays in the Dashboard
 */
export class DashboardDisplayProgressLog implements ProgressLog {

    private readonly rolarProgressLog: RolarProgressLog;

    constructor(rolarBaseUrl: string,
                bufferSize: number,
                flushInterval: number,
                private readonly context: HandlerContext,
                private readonly sdmGoal: SdmGoalEvent) {
        this.rolarProgressLog =
            new RolarProgressLog(rolarBaseUrl, constructLogPath(context, sdmGoal), bufferSize, flushInterval);
    }

    get name() {
        return this.rolarProgressLog.name;
    }

    get url() {
        const path = constructLogPath(this.context, this.sdmGoal);
        return `https://app.atomist.com/workspace/${path[0]}/logs/${path.slice(1).join("/")}`;
    }

    public async isAvailable(): Promise<boolean> {
        return this.rolarProgressLog.isAvailable();
    }

    public write(what: string) {
        this.rolarProgressLog.write(what);
    }

    public flush(): Promise<any> {
        return this.rolarProgressLog.flush();
    }

    public close(): Promise<any> {
        return this.rolarProgressLog.close();
    }

}

export function constructLogPath(context: HandlerContext, sdmGoal: SdmGoalEvent): string[] {
    return [
        context.workspaceId,
        sdmGoal.repo.owner,
        sdmGoal.repo.name,
        sdmGoal.sha,
        sdmGoal.environment,
        sdmGoal.name,
        sdmGoal.goalSetId,
        context.correlationId,
    ];
}
