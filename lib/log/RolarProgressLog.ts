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
    DefaultHttpClientFactory,
    doWithRetry,
    HttpClient,
    HttpClientFactory,
    HttpMethod,
    logger,
} from "@atomist/automation-client";
import { ProgressLog } from "@atomist/sdm";
import * as _ from "lodash";
import { WrapOptions } from "retry";
import os = require("os");

function* timestampGenerator() {
    while (true) {
        yield new Date();
    }
}

/**
 * Post log to Atomist Rolar service for it to persist
 */
export class RolarProgressLog implements ProgressLog {

    private httpClient: HttpClient;
    private localLogs: LogData[] = [];
    private readonly timer: any;

    constructor(private readonly rolarBaseUrl: string,
                private readonly logPath: string[],
                private readonly bufferSizeLimit: number = 1000,
                private readonly timerInterval: number = 0,
                private readonly httpClientFactory: HttpClientFactory,
                private readonly logLevel: string = "info",
                private readonly timestamper: Iterator<Date> = timestampGenerator()) {
        if (this.timerInterval > 0) {
            this.timer = setInterval(() => this.flush(), 2000);
        }
        this.httpClient = httpClientFactory.create(rolarBaseUrl);
    }

    get name() {
        return this.logPath.join("/");
    }

    get url() {
        return `${this.rolarBaseUrl}/logs/${this.name}`;
    }

    public async isAvailable(): Promise<boolean> {
        const url = `${this.rolarBaseUrl}/api/logs`;
        try {
            await this.httpClient.exchange(url, { method: HttpMethod.Head });
            return true;
        } catch (e) {
            logger.warn(`Rolar logger is NOT available at ${url}: ${e}`);
            return false;
        }
    }

    public write(what: string) {
        const line = what || "";
        const now: Date = this.timestamper.next().value;
        this.localLogs.push({
            level: this.logLevel,
            message: line,
            timestamp: this.constructUtcTimestamp(now),
            timestampMillis: this.constructMillisTimestamp(now),
        } as LogData);
        const bufferSize = this.localLogs.reduce((acc, logData) => acc + logData.message.length, 0);
        if (bufferSize > this.bufferSizeLimit) {
            // tslint:disable-next-line:no-floating-promises
            this.flush();
        }
    }

    public flush(): Promise<any> {
        return this.postLogs(false);
    }

    public close(): Promise<any> {
        if (this.timer) {
            clearInterval(this.timer);
        }
        return this.postLogs(true);
    }

    private async postLogs(isClosed: boolean): Promise<any> {
        const postingLogs = this.localLogs;
        this.localLogs = [];

        if (postingLogs && postingLogs.length > 0) {

            const closedRequestParam = isClosed ? "?closed=true" : "";
            const url = `${this.rolarBaseUrl}/api/logs/${this.logPath.join("/")}${closedRequestParam}`;
            let result;
            try {
                result = await this.httpClient.exchange(url, {
                    method: HttpMethod.Post,
                    body: {
                        host: os.hostname(),
                        content: postingLogs,
                    },
                    headers: { "Content-Type": "application/json" },
                })
            } catch (err) {
                this.localLogs = postingLogs.concat(this.localLogs);
                logger.error(err);
            }
            return result;
        }
        return Promise.resolve();
    }

    private constructUtcTimestamp(d: Date): string {
        const now: Date = d;
        const date = [now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCFullYear()]
            .map(t => _.padStart(t.toString(), 2, "0"));
        const time = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
            .map(t => _.padStart(t.toString(), 2, "0"));
        return `${date.join("/")} ${time.join(":")}.${_.padStart(now.getUTCMilliseconds().toString(), 3, "0")}`;
    }

    private constructMillisTimestamp(d: Date): number {
        return d.valueOf();
    }
}

interface LogData {
    level: string;
    message: string;
    timestamp: string;
    timestampMillis: number;
}
