/*
 * Copyright © 2019 Atomist, Inc.
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

export function loadKubeClusterConfig(): k8s.KubeConfig {
    const kc = new k8s.KubeConfig();
    try {
        kc.loadFromCluster();
    } catch (e) {
        logger.debug("Failed to to load in-cluster config, attempting default");
        try {
            kc.loadFromDefault();
        } catch (ex) {
            logger.debug("Failed to to load default config");
        }
    }
    return kc;
}
