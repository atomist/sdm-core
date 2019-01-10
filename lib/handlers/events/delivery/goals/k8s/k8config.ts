import { logger } from "@atomist/automation-client";
import * as k8s from "@kubernetes/client-node";

/**
 * Get Kubernetes configuration either from the creds directory or the
 * in-cluster client.
 */
export function loadKubeConfig(): k8s.KubeConfig {
    const kc = new k8s.KubeConfig();
    try {
        kc.loadFromDefault();
    } catch (e) {
        logger.debug("Failed to to load default config, attempting in-cluster");
        kc.loadFromCluster();
    }
    return kc;
}
