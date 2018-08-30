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
import { ConfigurationPostProcessor } from "@atomist/automation-client/configuration";
import { guid } from "@atomist/automation-client/internal/util/string";
import { SoftwareDeliveryMachine } from "@atomist/sdm/api/machine/SoftwareDeliveryMachine";
import { SoftwareDeliveryMachineConfiguration } from "@atomist/sdm/api/machine/SoftwareDeliveryMachineOptions";
import * as _ from "lodash";
import { GoalAutomationEventListener } from "../../handlers/events/delivery/goals/GoalAutomationEventListener";
import { defaultSoftwareDeliveryMachineConfiguration } from "../../machine/defaultSoftwareDeliveryMachineConfiguration";
import {
    sdmExtensionPackStartupMessage,
    sdmStartupMessage,
} from "../util/startupMessage";
import {
    isInLocalMode,
    LocalSoftwareDeliveryMachineConfiguration,
} from "./LocalSoftwareDeliveryMachineOptions";

/**
 * Describe the type of configuration value
 */
export enum ConfigurationValueType {
    Number,
    String,
    Boolean,
}
/**
 * Options that are used during configuration of an SDM but don't get passed on to the
 * running SDM instance
 */
export interface ConfigureOptions {
    /**
     * Optional array of required configuration value paths resolved against the root configuration
     */
    requiredConfigurationValues?: Array<string | { path: string, type: ConfigurationValueType }>;
}

/**
 * Type that can create a fully configured SDM
 */
export type SoftwareDeliveryMachineMaker =
    (configuration: LocalSoftwareDeliveryMachineConfiguration) => SoftwareDeliveryMachine;

/**
 * Configure and set up a Software Delivery Machine instance with the automation-client framework for standalone
 * or single goal based execution
 * @param {(configuration: (Configuration & SoftwareDeliveryMachineOptions)) => SoftwareDeliveryMachine} machineMaker
 * @param {ConfigureOptions} options
 * @returns {ConfigurationPostProcessor}
 */
export function configureSdm(machineMaker: SoftwareDeliveryMachineMaker,
                             options: ConfigureOptions = {}): ConfigurationPostProcessor<LocalSoftwareDeliveryMachineConfiguration> {

    return async (config: Configuration) => {
        let mergedConfig = config as LocalSoftwareDeliveryMachineConfiguration;

        // Configure the local SDM
        mergedConfig = await doWithSdmLocal(local => {
            return local.configureLocal()(mergedConfig);
        }) || mergedConfig;

        const defaultSdmConfiguration = defaultSoftwareDeliveryMachineConfiguration(config);
        mergedConfig = _.merge(defaultSdmConfiguration, mergedConfig);

        validateConfiguration(mergedConfig, options);
        const sdm = machineMaker(mergedConfig);

        await doWithSdmLocal(local =>
            sdm.addExtensionPacks(local.LocalLifecycle, local.LocalSdmConfig),
        );

        // Configure the job forking ability
        configureJobLaunching(mergedConfig, sdm);

        await registerMetadata(mergedConfig, sdm);

        // Register startup message detail
        _.update(mergedConfig, "logging.banner.contributors",
            old => !!old ? old : []);
        mergedConfig.logging.banner.contributors.push(
            sdmStartupMessage(sdm),
            sdmExtensionPackStartupMessage(sdm));

        return mergedConfig;
    };
}

function configureJobLaunching(mergedConfig, machine) {
    const forked = process.env.ATOMIST_ISOLATED_GOAL === "true";
    if (forked) {
        configureSdmToRunExactlyOneGoal(mergedConfig, machine);
    } else {
        _.update(mergedConfig, "commands",
            old => !!old ? old : []);
        mergedConfig.commands.push(...machine.commandHandlers);

        _.update(mergedConfig, "events",
            old => !!old ? old : []);
        mergedConfig.events.push(...machine.eventHandlers);

        _.update(mergedConfig, "ingesters",
            old => !!old ? old : []);
        mergedConfig.ingesters.push(...machine.ingesters);
    }
}

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

export function validateConfiguration(config: any, options: ConfigureOptions) {
    const missingValues = [];
    const invalidValues = [];
    (options.requiredConfigurationValues || []).forEach(v => {
        const path = typeof v === "string" ? v : v.path;
        const type = typeof v === "string" ? ConfigurationValueType.String : v.type;
        const value = _.get(config, path);
        if (!value) {
            missingValues.push(path);
        } else {
            switch (type) {
                case ConfigurationValueType.Number :
                    if (!Number.isNaN(value)) {
                        invalidValues.push(`${path} ${JSON.stringify(value)} is not a 'number'`);
                    }
                    break;
                case ConfigurationValueType.String :
                    if (typeof value !== "string") {
                        invalidValues.push(`${path} ${JSON.stringify(value)} is not a 'string'`);
                    }
                    break;
                case ConfigurationValueType.Boolean :
                    if (typeof value !== "boolean") {
                        invalidValues.push(`${path} ${JSON.stringify(value)} is not a 'boolean'`);
                    }
                    break;
            }
        }
    });
    const errors = [];
    if (missingValues.length > 0) {
        errors.push(`Missing configuration values. Please add the following values to your client configuration: '${
            missingValues.join(", ")}'`);
    }
    if (invalidValues.length > 0) {
        errors.push(`Invalid configuration values. The following values have the wrong type: '${
            invalidValues.join(", ")}'`);
    }
    if (errors.length > 0) {
        throw new Error(errors.join("\n"));
    }
}

async function registerMetadata(config: Configuration, machine: SoftwareDeliveryMachine) {
    const sdmPj = require("@atomist/sdm/package.json");
    const sdmCorePj = require("@atomist/sdm-core/package.json");

    config.metadata = {
        ...config.metadata,
        "atomist.sdm": `${sdmPj.name}:${sdmPj.version}`,
        "atomist.sdm-core": `${sdmCorePj.name}:${sdmCorePj.version}`,
        "atomist.sdm.name": machine.name,
        "atomist.sdm.extension-packs": machine.extensionPacks.map(ex => `${ex.name}:${ex.version}`).join(", "),
    };

    await doWithSdmLocal(() => {
        const sdmLocalPj = require("@atomist/sdm-local/package.json");
        config.metadata["atomist.sdm-local"] = `${sdmLocalPj.name}:${sdmLocalPj.version}`;
    });
}

/**
 * Perform the given operation with the sdm-local module if it's available.
 * If it isn't, silently continue without error.
 * @param {(sdmLocal: any) => any} callback
 * @return {any}
 */
async function doWithSdmLocal(callback: (sdmLocal: any) => any) {
    try {
        if (isInLocalMode()) {
            const local = require("@atomist/sdm-local");
            return callback(local);
        }
    } catch (err) {
        // When npm linking we accept this error and move on
        if (!process.env.ATOMIST_NPM_LOCAL_LINK) {
            throw new Error("SDM started in local mode, but '@atomist/sdm-local' not declared as dependency. " +
                "Please install SDM local with 'npm install @atomist/sdm-local'.");
        }
    }
}
