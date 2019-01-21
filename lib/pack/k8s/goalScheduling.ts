import {
    ExtensionPack,
    metadata,
} from "@atomist/sdm";
import {
    isConfiguredInEnv,
    KubernetesGoalScheduler,
} from "./KubernetesGoalScheduler";
import { KubernetesJobDeletingGoalCompletionListenerFactory } from "./KubernetesJobDeletingGoalCompletionListener";

/**
 * Extension pack to schedule goals as k8s jobs when marked as isolated = true.
 */
export function goalScheduling(): ExtensionPack {
    return {
        ...metadata("k8s-goal-scheduling"),
        configure: sdm => {
            if (!process.env.ATOMIST_ISOLATED_GOAL && isConfiguredInEnv("kubernetes", "kubernetes-all")) {
                sdm.addGoalCompletionListener(new KubernetesJobDeletingGoalCompletionListenerFactory(sdm).create());
                sdm.configuration.sdm.goalScheduler = [new KubernetesGoalScheduler()];
            }
        },
    };
}
