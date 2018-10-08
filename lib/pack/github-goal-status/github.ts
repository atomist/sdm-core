import {
    ExtensionPack,
    metadata,
} from "@atomist/sdm";
import { isInLocalMode } from "../../internal/machine/LocalSoftwareDeliveryMachineOptions";
import {
    createPendingGitHubStatusOnGoalSet,
    setGitHubStatusOnGoalCompletion,
} from "./statusSetters";

/**
 * Manage a GitHub status per SDM
 */
export const GitHubGoalStatus: ExtensionPack = {
    ...metadata("github-goal-status"),
    configure: sdm => {
        if (!isInLocalMode()) {
            sdm.addGoalsSetListener(createPendingGitHubStatusOnGoalSet(sdm));
            sdm.addGoalCompletionListener(setGitHubStatusOnGoalCompletion(sdm));
        }
    },
};