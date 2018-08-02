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

import { Configuration } from "@atomist/automation-client";
import { SoftwareDeliveryMachine } from "@atomist/sdm";
import chalk from "chalk";

/**
 * Print some SDM details to the startup banner of the client
 * @param sdm
 */
export function sdmStartupMessage(sdm: SoftwareDeliveryMachine): (configuration: Configuration) => string {
    return () => {
        let c: string = "";

        c += `  ${chalk.grey("SDM")}
    ${sdm.name}

`;
        c += `  ${chalk.grey("Extension Packs")}
${sdm.extensionPacks.map(ex => `    ${ex.name}:${ex.version}  ${chalk.grey("by")} ${ex.vendor}`).join("\n")}`;

        return c;
    }
}