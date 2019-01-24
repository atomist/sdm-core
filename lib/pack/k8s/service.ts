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

import {
    RepoContext,
    SdmGoalEvent,
    ServiceRegistration,
} from "@atomist/sdm";
import * as k8s from "@kubernetes/client-node";

/**
 * Key of k8s services inside the service structure of goal data
 */
export const K8sServiceRegistrationType: string = "atomist.com/sdm/service/k8s";

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
        type: "atomist.com/sdm/service/k8s";
        spec: K8sServiceSpec;
    } | undefined>;
}
