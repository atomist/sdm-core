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
    failure,
    HandlerError,
    HandlerResult,
    MappedParameter,
    MappedParameters,
    Success,
} from "@atomist/automation-client";
import { Parameters } from "@atomist/automation-client/decorators";
import { addressEvent } from "@atomist/automation-client/spi/message/MessageClient";
import {
    CommandHandlerRegistration,
    CommandListenerInvocation,
} from "@atomist/sdm";
import {
    DeployEnablementRootType,
    SdmDeployEnablement,
} from "../../ingesters/sdmDeployEnablement";
import { success } from "../../util/slack/messages";

@Parameters()
export class SetDeployEnablementParameters {

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo: string;

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

}

/**
 * Command to set deploy enablement on the currently mapped repo
 * @param {CommandListenerInvocation} cli
 * @param {boolean} enable
 * @returns {Promise<HandlerResult | HandlerError>}IsnOde
 */
export function setDeployEnablement(cli: CommandListenerInvocation,
                                    enable: boolean): Promise<HandlerResult | HandlerError> {
    const deployEnablement: SdmDeployEnablement = {
        state: enable ? "requested" : "disabled",
        owner: cli.parameters.owner,
        repo: cli.parameters.repo,
        providerId: cli.parameters.providerId,
    };
    return cli.context.messageClient.send(deployEnablement, addressEvent(DeployEnablementRootType))
        .then(() => cli.context.messageClient.respond(
            success(
                "Deploy Enablement",
                `Successfully ${enable ? "enabled" : "disabled"} deployment`)))
        .then(() => Success, failure);
}

export const EnableDeploy: CommandHandlerRegistration<SetDeployEnablementParameters> = {
    name: "EnableDeploy",
    intent: "enable deploy",
    description: "Enable deployment via Atomist SDM",
    paramsMaker: SetDeployEnablementParameters,
    listener: async cli => setDeployEnablement(cli, true),
};

export const DisableDeploy: CommandHandlerRegistration<SetDeployEnablementParameters> = {
    name: "DisableDeploy",
    intent: "disable deploy",
    description: "Disable deployment via Atomist SDM",
    paramsMaker: SetDeployEnablementParameters,
    listener: async cli => setDeployEnablement(cli, false),
};
