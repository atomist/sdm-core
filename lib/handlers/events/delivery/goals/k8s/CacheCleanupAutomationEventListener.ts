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
    AutomationClient,
    AutomationEventListenerSupport,
    logger,
} from "@atomist/automation-client";
import { SoftwareDeliveryMachine } from "@atomist/sdm";
import * as cluster from "cluster";
import * as fs from "fs-extra";
import * as glob from "glob";
import * as _ from "lodash";
import * as path from "path";

/**
 * Event listener that cleans up cached artifacts that are older then 2 hours.
 */
export class CacheCleanupAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        super();
    }

    public async startupSuccessful(client: AutomationClient): Promise<void> {
        if (cluster.isMaster && _.get(this.sdm, "configuration.sdm.cache.enabled")) {
            const cachePath = _.get(this.sdm, "configuration.sdm.cache.path", "/opt/data");

            setTimeout(() => {
                const ts = Date.now() - (1000 * 60 * 60 * 2); // 2 hour threshold
                if (fs.existsSync(cachePath)) {
                    try {
                        new glob.Glob("**/*", { cwd: cachePath }, (err, matches) => {
                            matches.forEach(m => {
                                const p = path.join(cachePath, m);
                                try {
                                    const st = fs.statSync(p);
                                    if (st.mtimeMs < ts && st.isFile()) {
                                        logger.debug(`Deleting cached file '${p}'`);
                                        fs.removeSync(p);
                                    }
                                } catch (e) {
                                    logger.warn("Failed to delete cached file '%s': %s", p, e.message);
                                }
                            });
                        });
                    } catch (err) {
                        logger.warn("Failed to clean cache directory '%s': %s", cachePath, err.message);
                    }
                }
            });
        }
    }
}
