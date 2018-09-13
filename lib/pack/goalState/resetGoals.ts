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
    logger,
    MappedParameter,
    MappedParameters,
    Parameter,
    Success,
    Value,
} from "@atomist/automation-client";
import { Parameters } from "@atomist/automation-client/lib/decorators";
import { CommandHandlerRegistration, CommandListenerInvocation, GitHubRepoTargets, SoftwareDeliveryMachine } from "@atomist/sdm";
import { chooseAndSetGoals } from "@atomist/sdm/lib/api-helper/goal/chooseAndSetGoals";
import { toRepoTargetingParametersMaker } from "@atomist/sdm/lib/api-helper/machine/handlerRegistrations";
import { RepoTargetingParameters } from "@atomist/sdm/lib/api-helper/machine/RepoTargetingParameters";
import {
    success,
    warning,
} from "@atomist/sdm/lib/api-helper/misc/slack/messages";
import {
    bold,
    codeLine,
    italic,
} from "@atomist/slack-messages";
import {
    PushForCommit,
    RepoBranchTips,
} from "../../typings/types";
import { fetchBranchTips, fetchPushForCommit, tipOfBranch } from "../../util/graph/queryCommits";

@Parameters()
export class ResetGoalsParameters extends GitHubRepoTargets {

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

    @Value("name")
    public name: string;

    @Value("version")
    public version: string;

}

export function resetGoalsCommand(sdm: SoftwareDeliveryMachine): CommandHandlerRegistration {
    return {
        name: "ResetGoalsOnCommit",
        paramsMaker: toRepoTargetingParametersMaker(ResetGoalsParameters, GitHubRepoTargets),
        listener: resetGoalsOnCommit(sdm),
        intent: ["reset goals"],
    };
}

function resetGoalsOnCommit(sdm: SoftwareDeliveryMachine) {
    return async (cli: CommandListenerInvocation<ResetGoalsParameters & RepoTargetingParameters>) => {
        if (!cli.credentials) {
            throw new Error("This is invalid. I need credentials");
        }
        const rules = {
            projectLoader: sdm.configuration.sdm.projectLoader,
            repoRefResolver: sdm.configuration.sdm.repoRefResolver,
            goalsListeners: sdm.goalsSetListeners,
            goalSetter: sdm.pushMapping,
            implementationMapping: sdm.goalFulfillmentMapper,
        };

        const commandParams = { ...cli.parameters, ...cli.parameters.targets.repoRef };
        const id = cli.parameters.targets.repoRef;

        if (!isValidSHA1(id.sha)) {
            logger.info("Fetching tip of branch %s", id.branch);
            const allBranchTips = await fetchBranchTips(cli.context, {
                repo: id.repo, owner: id.owner, providerId: cli.parameters.providerId,
            });
            id.sha = tipOfBranch(allBranchTips, id.branch);
            logger.info("Learned that the tip of %s is %s", id.branch, id.sha);
        }

        const push = await fetchPushForCommit(cli.context, id, commandParams.providerId);

        const goals = await chooseAndSetGoals(rules, {
            context: cli.context,
            credentials: cli.credentials,
            push,
        });

        if (goals) {
            await cli.addressChannels(success(
                "Plan Goals",
                `Successfully planned goals on ${codeLine(push.after.sha.slice(0, 7))} of ${
                bold(`${commandParams.owner}/${commandParams.repo}/${push.branch}`)} to ${italic(goals.name)}`,
                {
                    footer: `${commandParams.name}:${commandParams.version}`,
                }));
        } else {
            await cli.addressChannels(warning(
                "Plan Goals",
                `No goals found for ${codeLine(push.after.sha.slice(0, 7))} of ${
                bold(`${commandParams.owner}/${commandParams.repo}/${push.branch}`)}`,
                cli.context,
                {
                    footer: `${commandParams.name}:${commandParams.version}`,
                }));
        }

        return Success;
    };
}

function isValidSHA1(s: string): boolean {
    return s.match(/[a-fA-F0-9]{40}/) != null;
}
