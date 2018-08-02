import { Configuration } from "@atomist/automation-client";
import { BannerSection } from "@atomist/automation-client/configuration";
import { SoftwareDeliveryMachine } from "@atomist/sdm";
import chalk from "chalk";

/**
 * Print some SDM details to the startup banner of the client
 * @param sdm
 */
export function sdmStartupMessage(sdm: SoftwareDeliveryMachine):
    (configuration: Configuration) => string | BannerSection {
    return () => ({
        title: "SDM",
        body: `${sdm.name}  ${process.env.ATOMIST_MODE === "local" ? `${chalk.gray("Local")} true` : "" }`,
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
