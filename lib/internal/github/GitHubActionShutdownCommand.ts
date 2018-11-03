import { NoParameters } from "@atomist/automation-client";
import { HandleCommand } from "@atomist/automation-client/lib/HandleCommand";
import { commandHandlerFrom } from "@atomist/automation-client/lib/onCommand";
import { SoftwareDeliveryMachine } from "@atomist/sdm";

export function gitHubActionShutdownCommand(machine: SoftwareDeliveryMachine): HandleCommand<NoParameters> {
    return commandHandlerFrom(
        async (ctx, parameters) => process.exit(1),
        NoParameters,
        "GitHubActionShutdown",
        "Shutdown the running SDM",
        [`shutdown ${machine.configuration.name.replace("@", "")}`]);
}