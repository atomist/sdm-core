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
    GitHubRepoRef,
    Maker,
    MappedParameter,
    MappedParameters,
    Parameters,
    Success,
    Value,
} from "@atomist/automation-client";
import {
    chooseAndSetGoals,
    CommandHandlerRegistration,
    CommandListener,
    CommandListenerInvocation,
    GitHubRepoTargets,
    RepoTargetingParameters,
    RepoTargets,
    slackSuccessMessage,
    slackWarningMessage,
    SoftwareDeliveryMachine,
    toRepoTargetingParametersMaker,
} from "@atomist/sdm";
import {
    bold,
    codeLine,
    italic,
} from "@atomist/slack-messages";
import {
    fetchBranchTips,
    fetchPushForCommit,
    tipOfBranch,
} from "../../util/graph/queryCommits";

@Parameters()
export class ResetGoalsParameters {

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

    @Value("name")
    public name: string;

    @Value("version")
    public version: string;

}

export function resetGoalsCommand(sdm: SoftwareDeliveryMachine,
                                  repoTargets: Maker<RepoTargets> = GitHubRepoTargets): CommandHandlerRegistration {
    return {
        name: "ResetGoalsOnCommit",
        description: "Plan goals on a commit",
        paramsMaker: toRepoTargetingParametersMaker(ResetGoalsParameters, repoTargets),
        listener: resetGoalsOnCommit(sdm),
        intent: [
            `reset goals ${sdm.configuration.name.replace("@", "")}`,
            `plan goals ${sdm.configuration.name.replace("@", "")}`,
        ],
    };
}

function resetGoalsOnCommit(sdm: SoftwareDeliveryMachine): CommandListener<ResetGoalsParameters> {
    return async (cli: CommandListenerInvocation<ResetGoalsParameters & RepoTargetingParameters>) => {

        const rules = {
            projectLoader: sdm.configuration.sdm.projectLoader,
            repoRefResolver: sdm.configuration.sdm.repoRefResolver,
            goalsListeners: [...sdm.goalsSetListeners],
            goalSetter: sdm.pushMapping,
            implementationMapping: sdm.goalFulfillmentMapper,
            preferencesFactory: sdm.configuration.sdm.preferenceStoreFactory,
        };

        let repoData;
        try {
            repoData = await fetchBranchTips(cli.context, {
                providerId: cli.parameters.providerId,
                owner: cli.parameters.targets.repoRef.owner,
                repo: cli.parameters.targets.repoRef.repo,
            });
        } catch (e) {
            return cli.context.messageClient.respond(
                slackWarningMessage(
                    "Set Goal State",
                    `Repository ${bold(`${
                        cli.parameters.targets.repoRef.owner}/${cli.parameters.targets.repoRef.repo}`)} not found`,
                    cli.context));
        }
        const branch = cli.parameters.targets.repoRef.branch || repoData.defaultBranch;
        let sha;
        try {
            sha = cli.parameters.targets.repoRef.sha || tipOfBranch(repoData, branch);
        } catch (e) {
            return cli.context.messageClient.respond(
                slackWarningMessage(
                    "Set Goal State",
                    `Branch ${bold(branch)} not found on ${bold(`${
                        cli.parameters.targets.repoRef.owner}/${cli.parameters.targets.repoRef.repo}`)}`,
                    cli.context));
        }

        const id = GitHubRepoRef.from({
            owner: cli.parameters.targets.repoRef.owner,
            repo: cli.parameters.targets.repoRef.repo,
            sha,
            branch,
        });

        const push = await fetchPushForCommit(cli.context, id, cli.parameters.providerId);

        const goals = await chooseAndSetGoals(rules, {
            context: cli.context,
            credentials: cli.credentials,
            push,
        });

        if (goals) {
            await cli.addressChannels(slackSuccessMessage(
                "Plan Goals",
                `Successfully planned goals on ${codeLine(push.after.sha.slice(0, 7))} of ${
                    bold(`${id.owner}/${id.repo}/${push.branch}`)} to ${italic(goals.name)}`,
                {
                    footer: `${cli.parameters.name}:${cli.parameters.version}`,
                }));
        } else {
            await cli.addressChannels(slackWarningMessage(
                "Plan Goals",
                `No goals found for ${codeLine(push.after.sha.slice(0, 7))} of ${
                    bold(`${id.owner}/${id.repo}/${push.branch}`)}`,
                cli.context,
                {
                    footer: `${cli.parameters.name}:${cli.parameters.version}`,
                }));
        }

        return Success;
    };
}
