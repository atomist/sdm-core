/*
 * Copyright © 2018 Atomist, Inc.
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
    Configuration,
    RemoteGitProjectPersister,
} from "@atomist/automation-client";
import {
    allReposInTeam,
    CachingProjectLoader,
} from "@atomist/sdm";
import * as _ from "lodash";
import { DefaultRepoRefResolver } from "../handlers/common/DefaultRepoRefResolver";
import { GitHubCredentialsResolver } from "../handlers/common/GitHubCredentialsResolver";
import { createKubernetesGoalLauncher } from "../handlers/events/delivery/goals/k8s/launchGoalK8";
import { EphemeralLocalArtifactStore } from "../internal/artifact/local/EphemeralLocalArtifactStore";
import { LocalSoftwareDeliveryMachineConfiguration } from "../internal/machine/LocalSoftwareDeliveryMachineOptions";
import { rolarAndDashboardLogFactory } from "../log/rolarAndDashboardLogFactory";

export function defaultSoftwareDeliveryMachineConfiguration(configuration: Configuration): LocalSoftwareDeliveryMachineConfiguration {
    const repoRefResolver = new DefaultRepoRefResolver();
    return {
        sdm: {
            artifactStore: new EphemeralLocalArtifactStore(),
            projectLoader: new CachingProjectLoader(),
            logFactory: rolarAndDashboardLogFactory(_.get(configuration, "sdm.rolar.url"),
                _.get(configuration, "sdm.rolar.bufferSize", 1000),
                _.get(configuration, "sdm.rolar.flushInterval", 1000)),
            credentialsResolver: new GitHubCredentialsResolver(),
            repoRefResolver,
            repoFinder: allReposInTeam(repoRefResolver),
            projectPersister: RemoteGitProjectPersister,
            goalLauncher: process.env.ATOMIST_GOAL_LAUNCHER === "kubernetes" ? createKubernetesGoalLauncher() : undefined,
        },
        local: {
            preferLocalSeeds: true,
        },
    };
}
