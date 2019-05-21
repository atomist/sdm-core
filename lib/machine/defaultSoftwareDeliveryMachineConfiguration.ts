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

import { Configuration } from "@atomist/automation-client";
import { RemoteGitProjectPersister } from "@atomist/automation-client/lib/operations/generate/remoteGitProjectPersister";
import {
    allReposInTeam,
    CachingProjectLoader,
    commandRequestParameterPromptFactory,
} from "@atomist/sdm";
import { NoOpGoalCache } from "../goal/cache/NoOpGoalCache";
import { DefaultRepoRefResolver } from "../handlers/common/DefaultRepoRefResolver";
import { GitHubCredentialsResolver } from "../handlers/common/GitHubCredentialsResolver";
// tslint:disable-next-line:deprecation
import { EphemeralLocalArtifactStore } from "../internal/artifact/local/EphemeralLocalArtifactStore";
import { LocalSoftwareDeliveryMachineConfiguration } from "../internal/machine/LocalSoftwareDeliveryMachineOptions";
import { TeamConfigurationPreferenceStoreFactory } from "../internal/preferences/TeamConfigurationPreferenceStore";
import { rolarAndDashboardLogFactory } from "../log/rolarAndDashboardLogFactory";

export function defaultSoftwareDeliveryMachineConfiguration(configuration: Configuration): LocalSoftwareDeliveryMachineConfiguration {
    const repoRefResolver = new DefaultRepoRefResolver();
    return {
        sdm: {
            // tslint:disable-next-line:deprecation
            artifactStore: new EphemeralLocalArtifactStore(),
            projectLoader: new CachingProjectLoader(),
            logFactory: rolarAndDashboardLogFactory(configuration),
            credentialsResolver: new GitHubCredentialsResolver(),
            repoRefResolver,
            repoFinder: allReposInTeam(repoRefResolver),
            projectPersister: RemoteGitProjectPersister,
            goalScheduler: [],
            preferenceStoreFactory: TeamConfigurationPreferenceStoreFactory,
            parameterPromptFactory: commandRequestParameterPromptFactory,
            goalCache: new NoOpGoalCache(),
        },
        local: {
            preferLocalSeeds: true,
        },
    };
}
