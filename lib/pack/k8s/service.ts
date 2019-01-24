import {
    RepoContext,
    SdmGoalEvent,
    ServiceRegistration,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";

/**
 * Key of k8s services inside the service structure of goal data
 */
export const K8sServiceRegistrationType: string = "sdm-core/k8s";

/**
 * K8s specific service spec
 *
 * Allows to register additional containers that are being added to the goal job.
 * Open for future extension to support adding other k8s resource types.
 */
export interface K8sServiceSpec {
    container: k8s.V1Container | k8s.V1Container[];
}

/**
 * K8s specific service registration
 */
export interface K8sServiceRegistration extends ServiceRegistration<K8sServiceSpec> {
    service: (goalEvent: SdmGoalEvent, repo: RepoContext) => Promise<{
        type: "sdm-core/k8s";
        spec: K8sServiceSpec;
    } | undefined>;
}
