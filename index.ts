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

export {
    GitHubCredentialsResolver,
} from "./lib/handlers/common/GitHubCredentialsResolver";
export {
    ConfigurationBasedBasicCredentialsResolver,
} from "./lib/handlers/common/ConfigurationBasedBasicCredentialsResolver";
export {
    Tag,
} from "./lib/goal/common/Tag";
export {
    Version,
    ProjectVersionerRegistration,
} from "./lib/goal/common/Version";
export {
    Container,
    container,
    ContainerPort,
    ContainerProjectHome,
    ContainerRegistration,
    ContainerScheduler,
    ContainerSpecCallback,
    ContainerVolumeMount,
    GoalContainer,
    GoalContainerVolume,
} from "./lib/goal/container/container";
export {
    DockerContainerRegistration,
} from "./lib/goal/container/docker";
export {
    K8sContainerRegistration,
    K8sContainerSpecCallback,
    K8sGoalContainerSpec,
} from "./lib/goal/container/k8s";
export {
    DisplayDeployEnablement,
} from "./lib/handlers/commands/DisplayDeployEnablement";
export {
    DisableDeploy,
    EnableDeploy,
    setDeployEnablement,
    SetDeployEnablementParameters,
} from "./lib/handlers/commands/SetDeployEnablement";
export {
    DefaultRepoRefResolver,
} from "./lib/handlers/common/DefaultRepoRefResolver";
export {
    EphemeralLocalArtifactStore,
} from "./lib/internal/artifact/local/EphemeralLocalArtifactStore";
export {
    createTagForStatus,
    executeTag,
} from "./lib/internal/delivery/build/executeTag";
export {
    ProjectIdentifier,
} from "./lib/internal/delivery/build/local/projectIdentifier";
export {
    executeVersioner,
    ProjectVersioner,
    readSdmVersion,
} from "./lib/internal/delivery/build/local/projectVersioner";
export {
    DefaultLocalDeployerOptions,
    LocalDeployerOptions,
    SpawnedDeployment,
    StartupInfo,
} from "./lib/internal/delivery/deploy/local/LocalDeployerOptions";
export {
    DeployedApp,
    LookupStrategy,
    ManagedDeployments,
    ManagedDeploymentTargeter,
    ManagedDeploymentTargetInfo,
} from "./lib/internal/delivery/deploy/local/ManagedDeployments";
export {
    ConfigureOptions,
    configureSdm,
    SoftwareDeliveryMachineMaker,
} from "./lib/internal/machine/configureSdm";
export {
    LocalSoftwareDeliveryMachineConfiguration,
    LocalSoftwareDeliveryMachineOptions,
} from "./lib/internal/machine/LocalSoftwareDeliveryMachineOptions";
export {
    isInLocalMode,
    isGitHubAction,
    IsGitHubAction,
    IsInLocalMode,
} from "./lib/internal/machine/modes";
export {
    constructLogPath,
} from "./lib/log/DashboardDisplayProgressLog";
export {
    RolarProgressLog,
} from "./lib/log/RolarProgressLog";
export {
    createSoftwareDeliveryMachine,
} from "./lib/machine/machineFactory";
export {
    ToPublicRepo,
} from "./lib/mapping/pushtest/toPublicRepo";
export {
    CoreRepoFieldsAndChannels,
    OnChannelLink,
    OnRepoOnboarded,
    PersonByChatId,
    SdmVersionForCommit,
} from "./lib/typings/types";
import * as github from "./lib/util/github/ghub";

export {
    gitHubGoalStatus,
    githubGoalStatusSupport,
} from "./lib/pack/github-goal-status/github";
export {
    goalState,
    goalStateSupport,
} from "./lib/pack/goal-state/goalState";
export {
    exposeInfo,
    infoSupport,
} from "./lib/pack/info/exposeInfo";
export {
    jobSupport,
} from "./lib/pack/job/job";
export {
    invokeCommand,
} from "./lib/pack/job/invokeCommand";
export { github };
export {
    tagRepo,
} from "./lib/util/github/tagRepo";
export {
    fetchBranchTips,
    tipOfBranch,
} from "./lib/util/graph/queryCommits";
export {
    truncateCommitMessage,
} from "./lib/util/lifecycleHelpers";
export {
    toArray,
} from "./lib/util/misc/array";
export {
    renderCommitMessage,
} from "./lib/util/slack/diffRendering";
export * from "./lib/util/webhook/ImageLink";
export {
    Preference,
    AbstractPreferenceStore,
} from "./lib/internal/preferences/AbstractPreferenceStore";
export { FilePreferenceStoreFactory } from "./lib/internal/preferences/FilePreferenceStore";
export { GraphQLPreferenceStoreFactory } from "./lib/internal/preferences/GraphQLPreferenceStore";
export { TeamConfigurationPreferenceStoreFactory } from "./lib/internal/preferences/TeamConfigurationPreferenceStore";
export {
    KubernetesGoalScheduler,
    sanitizeName,
    isConfiguredInEnv,
} from "./lib/pack/k8s/KubernetesGoalScheduler";
export {
    KubernetesJobDeletingGoalCompletionListenerFactory,
} from "./lib/pack/k8s/KubernetesJobDeletingGoalCompletionListener";
export {
    goalScheduling,
    k8sGoalSchedulingSupport,
} from "./lib/pack/k8s/goalScheduling";
export {
    K8sServiceSpec,
    K8sServiceRegistration,
} from "./lib/pack/k8s/service";
export {
    FileSystemGoalCacheArchiveStore,
} from "./lib/goal/cache/FileSystemGoalCacheArchiveStore";
export {
    CompressingGoalCache,
    GoalCacheArchiveStore,
} from "./lib/goal/cache/CompressingGoalCache";
export {
    NoOpGoalCache,
} from "./lib/goal/cache/NoOpGoalCache";
export {
    notificationSupport,
} from "./lib/pack/notification/notification";
export {
    cachePut,
    cacheRemove,
    cacheRestore,
    GoalCache,
    GoalCacheOptions,
} from "./lib/goal/cache/goalCaching";
export {
    configure,
    Configurer,
    GoalData,
    GoalStructure,
    CreateGoals,
    GoalConfigurer,
    GoalCreator,
    ConfigurationPreProcessor,
    AllGoals,
    DeliveryGoals,
} from "./lib/machine/configure";
export {
    UniversalTransform,
    universalGeneratorSupport,
    UniversalGeneratorSupportOptions,
} from "./lib/pack/universal-generator/generatorSupport";
export {
    universalGenerator,
} from "./lib/pack/universal-generator/generator";
export {
    assertUniversalGenerator,
} from "./lib/pack/universal-generator/test/assertGenerator";
