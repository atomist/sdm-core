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
import { BannerSection } from "@atomist/automation-client/lib/configuration";
import { SoftwareDeliveryMachine } from "@atomist/sdm";
import chalk from "chalk";
import { isInLocalMode } from "../machine/LocalSoftwareDeliveryMachineOptions";

/**
 * Print some SDM details to the startup banner of the client
 * @param sdm
 */
export function sdmStartupMessage(sdm: SoftwareDeliveryMachine):
    (configuration: Configuration) => string | BannerSection {
    return () => ({
        title: "SDM",
        body: `${sdm.name}${isInLocalMode() ? `  ${chalk.grey("started in")} ${chalk.green("local mode")}` : ""}`,
    });
}

export function sdmExtensionPackStartupMessage(sdm: SoftwareDeliveryMachine):
    (configuration: Configuration) => string | BannerSection {
    return () => ({
        title: sdm.extensionPacks.length > 1 ? "Extension Packs" : "Extension Pack",
        body: sdm.extensionPacks.map(ex => `${ex.name}:${ex.version}  ${chalk.gray("by")} ${ex.vendor}`)
            .sort((e1, e2) => e1.localeCompare(e2)).join("\n"),
    });
}
