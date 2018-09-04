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

import { MachineConfiguration } from "@atomist/sdm/api/machine/MachineConfiguration";
import { SoftwareDeliveryMachine } from "@atomist/sdm/api/machine/SoftwareDeliveryMachine";
import { SoftwareDeliveryMachineConfiguration } from "@atomist/sdm/api/machine/SoftwareDeliveryMachineOptions";
import { GoalSetter } from "@atomist/sdm/api/mapping/GoalSetter";
import { HandlerBasedSoftwareDeliveryMachine } from "../internal/machine/HandlerBasedSoftwareDeliveryMachine";
import { isInLocalMode } from "../internal/machine/LocalSoftwareDeliveryMachineOptions";
import { GoalState } from "../pack/goalState/goalState";
import { ExposeInfo } from "../pack/info/exposeInfo";

/**
 * Create a **Software Delivery MachineConfiguration** with default predefined goals.
 * Combines commands and delivery event handling using _goals_.
 *
 * Goals and goal "implementations" can be defined by users.
 * However, certain well known goals are built into the DefaultSoftwareDeliveryMachine
 * for convenience, with their own associated listeners.
 *
 * Well known goal support is based around a delivery process spanning
 * common goals of fingerprinting, reacting to fingerprint diffs,
 * code review, build, deployment, endpoint verification and
 * promotion to a production environment.
 *
 * The most important element of a software delivery machine is setting
 * zero or more _push rules_ in the constructor.
 * This is normally done using the internal DSL as follows:
 *
 * ```
 * const sdm = createSoftwareDeliveryMachine(
 *    "MyMachine",
 *    options,
 *    whenPushSatisfies(IsMaven, HasSpringBootApplicationClass, not(MaterialChangeToJavaRepo))
 *      .itMeans("No material change to Java")
 *      .setGoals(NoGoals),
 *    whenPushSatisfies(ToDefaultBranch, IsMaven, HasSpringBootApplicationClass, HasCloudFoundryManifest)
 *      .itMeans("Spring Boot service to deploy")
 *      .setGoals(HttpServiceGoals));
 * ```
 *
 * Uses the builder pattern to allow fluent construction. For example:
 *
 * ```
 * softwareDeliveryMachine
 *    .addPushReaction(async pu => ...)
 *    .addNewIssueListener(async i => ...)
 *    .add...;
 * ```
 */
export function createSoftwareDeliveryMachine(config: MachineConfiguration<SoftwareDeliveryMachineConfiguration>,
    // tslint:disable-next-line:max-line-length
    ...goalSetters: Array<GoalSetter | GoalSetter[]>): SoftwareDeliveryMachine<SoftwareDeliveryMachineConfiguration> {
    const machine = new HandlerBasedSoftwareDeliveryMachine(config.name, config.configuration,
        goalSetters);
    machine.addExtensionPacks(ExposeInfo);

    return machine;
}
