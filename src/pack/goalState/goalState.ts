import { ExtensionPack } from "@atomist/sdm";
import { metadata } from "@atomist/sdm/api-helper/misc/extensionPack";
import { resetGoalsCommand } from "./resetGoals";
import { setGoalStateCommand } from "./setGoalState";

/**
 * allow goal setting
 */
export const GoalState: ExtensionPack = {
    ...metadata("set goal state"),
    configure: sdm => {
        sdm.addCommand(setGoalStateCommand(sdm));
        sdm.addCommand(resetGoalsCommand({
            projectLoader: sdm.configuration.sdm.projectLoader,
            repoRefResolver: sdm.configuration.sdm.repoRefResolver,
            goalsListeners: sdm.goalsSetListeners,
            goalSetter: sdm.pushMapping,
            implementationMapping: sdm.goalFulfillmentMapper,
            name: sdm.configuration.name,
        }));
    },
};
