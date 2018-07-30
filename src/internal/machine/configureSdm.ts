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

import { Configuration } from "@atomist/automation-client";
import { guid } from "@atomist/automation-client/internal/util/string";
import { SoftwareDeliveryMachine } from "@atomist/sdm/api/machine/SoftwareDeliveryMachine";
import { SoftwareDeliveryMachineConfiguration } from "@atomist/sdm/api/machine/SoftwareDeliveryMachineOptions";
import * as appRoot from "app-root-path";
import * as _ from "lodash";
import * as path from "path";
import { GoalAutomationEventListener } from "../../handlers/events/delivery/goals/GoalAutomationEventListener";
import {
    defaultConfigureOptions,
    defaultSoftwareDeliveryMachineOptions,
} from "../../machine/defaultSoftwareDeliveryMachineOptions";

/**
 * Options that are used during configuration of an SDM but don't get passed on to the
 * running SDM instance
 */
export interface ConfigureOptions {
    /**
     * Optional array of required configuration value paths resolved against the root configuration
     */
    requiredConfigurationValues?: string[];

    /**
     * Configuration for local SDM
     */
    local?: {
        /**
         * Base of expanded directory tree the local client will work with:
         * The projects the SDM can operate on.
         * Under this we find /<org>/<repo>
         */
        repositoryOwnerParentDirectory: string;

        /**
         * Use local seeds (in whatever git state) vs cloning if possible?
         */
        preferLocalSeeds: boolean;

        /**
         * Whether to merge autofixes automatically
         */
        mergeAutofixes?: boolean;

        useSystemNotifications?: boolean;
    }
}

/**
 * Type that can create a fully configured SDM
 */
export type SoftwareDeliveryMachineMaker = (configuration: SoftwareDeliveryMachineConfiguration) => SoftwareDeliveryMachine;

/**
 * Configure and set up a Software Deliver Machine instance with the automation-client framework for standalone
 * or single goal based execution
 * @param {(configuration: (Configuration & SoftwareDeliveryMachineOptions)) => SoftwareDeliveryMachine} machineMaker
 * @param {ConfigureOptions} options
 * @returns {(config: Configuration) => Promise<Configuration & SoftwareDeliveryMachineOptions>}
 */
export function configureSdm(
    machineMaker: SoftwareDeliveryMachineMaker,
    options: ConfigureOptions = {}) {

    return async (config: Configuration) => {
        const defaultSdmOptions = defaultSoftwareDeliveryMachineOptions(config);
        let mergedConfig = _.merge(defaultSdmOptions, config) as SoftwareDeliveryMachineConfiguration;
        const defaultConfOptions = defaultConfigureOptions();
        const mergedOptions = _.merge(defaultConfOptions, options);

        // Configure the local SDM
        mergedConfig = await doWithSlalom(slalom => {
            return slalom.configureLocal(mergedOptions.local)
        })(mergedConfig);

        const sdm = machineMaker(mergedConfig);

        doWithSlalom(slalom => sdm.addExtensionPacks(slalom.LocalLifecycle));

        // Configure the job forking ability
        configureJobLaunching(mergedConfig, sdm, mergedOptions);

        registerMetadata(mergedConfig, sdm);
        return mergedConfig;
    };
}

function configureJobLaunching(mergedConfig, machine, mergedOptions) {
    const forked = process.env.ATOMIST_ISOLATED_GOAL === "true";
    if (forked) {
        configureSdmToRunExactlyOneGoal(mergedConfig, machine);
    } else {
        validateConfiguration(mergedConfig, mergedOptions);

        if (!mergedConfig.commands) {
            mergedConfig.commands = [];
        }
        mergedConfig.commands.push(...machine.commandHandlers);

        if (!mergedConfig.events) {
            mergedConfig.events = [];
        }
        mergedConfig.events.push(...machine.eventHandlers);

        if (!mergedConfig.ingesters) {
            mergedConfig.ingesters = [];
        }
        mergedConfig.ingesters.push(...machine.ingesters);
    }
};

function configureSdmToRunExactlyOneGoal(mergedConfig: SoftwareDeliveryMachineConfiguration,
                                         machine: SoftwareDeliveryMachine) {
    if (process.env.ATOMIST_JOB_NAME) {
        mergedConfig.name = process.env.ATOMIST_REGISTRATION_NAME;
    } else {
        mergedConfig.name = `${mergedConfig.name}-${process.env.ATOMIST_GOAL_ID || guid()}`;
    }

    // Force ephemeral policy and no handlers or ingesters
    mergedConfig.policy = "ephemeral";
    mergedConfig.commands = [];
    mergedConfig.events = [];
    mergedConfig.ingesters = [];

    mergedConfig.listeners.push(
        new GoalAutomationEventListener(
            machine.goalFulfillmentMapper,
            machine.configuration.sdm.projectLoader,
            machine.configuration.sdm.repoRefResolver,
            machine.configuration.sdm.credentialsResolver,
            machine.configuration.sdm.logFactory,
            machine.goalExecutionListeners));

    // Disable app events for forked clients
    mergedConfig.applicationEvents.enabled = false;
}

function validateConfiguration(config: Configuration, options: ConfigureOptions) {
    const missingValues = [];
    (options.requiredConfigurationValues || []).forEach(v => {
        if (!_.get(config, v)) {
            missingValues.push(v);
        }
    });
    if (missingValues.length > 0) {
        throw new Error(
            `Missing configuration values. Please add the following values to your client configuration: '${
                missingValues.join(", ")}'`);
    }
}

function registerMetadata(config: Configuration, machine: SoftwareDeliveryMachine) {
    const sdmPj = require(path.join(appRoot.path, "node_modules", "@atomist", "sdm", "package.json"));
    const sdmCorePj = require(path.join(appRoot.path, "node_modules", "@atomist", "sdm-core", "package.json"));

    config.metadata = {
        ...config.metadata,
        "atomist.sdm": `${sdmPj.name}:${sdmPj.version}`,
        "atomist.sdm-core": `${sdmCorePj.name}:${sdmCorePj.version}`,
        "atomist.sdm.name": machine.name,
        "atomist.sdm.extension-packs": machine.extensionPacks.map(ex => `${ex.name}:${ex.version}`).join(", "),
    };
}

function doWithSlalom(callback: (slalom: any) => any) {
    try {
        const local = require("@atomist/slalom");
        return callback(local);

    } catch (err) {
        // Nothing to report here
    }
}