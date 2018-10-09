import {
    AutomationClient,
    AutomationEventListenerSupport,
    logger,
} from "@atomist/automation-client";
import { SoftwareDeliveryMachine } from "@atomist/sdm";
import * as cluster from "cluster";
import * as fs from "fs-extra";
import * as _ from "lodash";

export class CacheCleanupAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        super();
    }

    public async startupSuccessful(client: AutomationClient): Promise<void> {
        if (cluster.isMaster && _.get(this.sdm, "configuration.sdm.cache.enabled")) {
            const path = _.get(this.sdm, "configuration.sdm.cache.path", "/opt/data");

            setTimeout(() => {
                const ts = Date.now() - (1000 * 60 * 60 * 2); // 2 hour threshold
                if (fs.existsSync(path)) {
                    fs.readdirSync(path).forEach(f => {
                        const p = path.join(path, f);
                        const st = fs.statSync(p);
                        if (st.mtimeMs < ts) {
                            logger.debug(`Deleting cached file '${p}'`);
                            fs.removeSync(p);
                        }
                    });
                }
            });
        }
    }
}