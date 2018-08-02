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