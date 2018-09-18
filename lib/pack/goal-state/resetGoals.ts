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
    GitHubRepoRef,
    MappedParameter,
    MappedParameters,
    Parameter,
    Parameters,
    Secret,
    Secrets,
    Success,
    Value,
} from "@atomist/automation-client";
import {
    chooseAndSetGoals,
    CommandHandlerRegistration,
    CommandListenerInvocation,
    GitHubRepoTargets,
    SoftwareDeliveryMachine,
    success,
    toRepoTargetingParametersMaker,
    warning,
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

    @Secret(Secrets.UserToken)
    public token: string;

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo: string;

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

    @Parameter({ required: false })
    public sha: string;

    @Parameter({ required: false })
    public branch: string;

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
        intent: [
            `reset goals ${sdm.configuration.name.replace("@", "")}`,
            "reset goals",
            `plan goals ${sdm.configuration.name.replace("@", "")}`,
            "plan goals",
        ],
    };
}

function resetGoalsOnCommit(sdm: SoftwareDeliveryMachine) {
    return async (cli: CommandListenerInvocation<ResetGoalsParameters>) => {

        const rules = {
            projectLoader: sdm.configuration.sdm.projectLoader,
            repoRefResolver: sdm.configuration.sdm.repoRefResolver,
            goalsListeners: sdm.goalsSetListeners,
            goalSetter: sdm.pushMapping,
            implementationMapping: sdm.goalFulfillmentMapper,
        };

        const repoData = await fetchBranchTips(cli.context, cli.parameters);
        const branch = cli.parameters.branch || repoData.defaultBranch;
        const sha = cli.parameters.sha || tipOfBranch(repoData, branch);
        const id = GitHubRepoRef.from({ owner: cli.parameters.owner, repo: cli.parameters.repo, sha, branch });

        const push = await fetchPushForCommit(cli.context, id, cli.parameters.providerId);

        const goals = await chooseAndSetGoals(rules, {
            context: cli.context,
            credentials: cli.credentials,
            push,
        });

        if (goals) {
            await cli.addressChannels(success(
                "Plan Goals",
                `Successfully planned goals on ${codeLine(push.after.sha.slice(0, 7))} of ${
                    bold(`${cli.parameters.owner}/${cli.parameters.repo}/${push.branch}`)} to ${italic(goals.name)}`,
                {
                    footer: `${cli.parameters.name}:${cli.parameters.version}`,
                }));
        } else {
            await cli.addressChannels(warning(
                "Plan Goals",
                `No goals found for ${codeLine(push.after.sha.slice(0, 7))} of ${
                    bold(`${cli.parameters.owner}/${cli.parameters.repo}/${push.branch}`)}`,
                cli.context,
                {
                    footer: `${cli.parameters.name}:${cli.parameters.version}`,
                }));
        }

        return Success;
    };
}
