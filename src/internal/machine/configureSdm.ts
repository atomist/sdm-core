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
    logger,
} from "@atomist/automation-client";
import { ConfigurationPostProcessor } from "@atomist/automation-client/configuration";
import { guid } from "@atomist/automation-client/internal/util/string";
import {
    ConfigurationValues,
    validateConfigurationValues,
} from "@atomist/sdm/api/machine/ConfigurationValues";
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
import { InvokeSdmStartupListenersAutomationEventListener } from "./InvokeSdmStartupListenersAutomationEventListener";

/**
 * Options passed to the set up of the SDM.
 */
// tslint:disable-next-line:no-empty-interface
export interface ConfigureOptions extends ConfigurationValues {
    // Empty for future extensibility
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
        mergedConfig = await doWithSdmLocal<LocalSoftwareDeliveryMachineConfiguration>(local => {
            return local.configureLocal()(mergedConfig);
        }) || mergedConfig;

        const defaultSdmConfiguration = defaultSoftwareDeliveryMachineConfiguration(config);
        mergedConfig = _.merge(defaultSdmConfiguration, mergedConfig);

        validateConfigurationValues(mergedConfig, options);
        const sdm = machineMaker(mergedConfig);

        await doWithSdmLocal<void>(local =>
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

        _.update(mergedConfig, "listeners",
            old => !!old ? old : []);
        mergedConfig.listeners.push(new InvokeSdmStartupListenersAutomationEventListener(sdm));

        return mergedConfig;
    };
}

/**
 * Configure how this SDM is going to handle goals
 * @param mergedConfig
 * @param machine
 */
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

/**
 * Configure SDM to run only one goal
 * @param mergedConfig
 * @param machine
 */
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

    mergedConfig.listeners.push(new GoalAutomationEventListener(machine));

    // Disable app events for forked clients
    mergedConfig.applicationEvents.enabled = false;
}

async function registerMetadata(config: Configuration, machine: SoftwareDeliveryMachine) {
    // tslint:disable-next-line:no-implicit-dependencies
    const sdmPj = require("@atomist/sdm/package.json");
    // tslint:disable-next-line:no-implicit-dependencies
    const sdmCorePj = require("@atomist/sdm-core/package.json");

    config.metadata = {
        ...config.metadata,
        "atomist.sdm": `${sdmPj.name}:${sdmPj.version}`,
        "atomist.sdm-core": `${sdmCorePj.name}:${sdmCorePj.version}`,
        "atomist.sdm.name": machine.name,
        "atomist.sdm.extension-packs": machine.extensionPacks.map(ex => `${ex.name}:${ex.version}`).join(", "),
    };

    await doWithSdmLocal(() => {
        // tslint:disable-next-line:no-implicit-dependencies
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
async function doWithSdmLocal<R>(callback: (sdmLocal: any) => any): Promise<R | null> {
    if (isInLocalMode()) {
        // tslint:disable-next-line:no-implicit-dependencies
        const local = attemptToRequire("@atomist/sdm-local", !process.env.ATOMIST_NPM_LOCAL_LINK);
        if (local) {
            return callback(local) as R;
        } else {
            logger.warn("Skipping local mode configuration because 'ATOMIST_NPM_LOCAL_LINK' was defined, " +
                "but '@atomist/sdm-local' could not be loaded");
            return null;
        }
    }
}

/**
 * Attempt to NPM require module
 * @param module
 * @param failOnError
 */
function attemptToRequire<T = any>(module: string, failOnError: boolean): T | null {
    try {
        return require(module) as T;
    } catch (err) {
        if (failOnError) {
            throw new Error(`Unable to load '${module}'. Please install with 'npm install ${module}'.`);
        } else {
            return null;
        }
    }

}
