/*
 * Copyright © 2020 Atomist, Inc.
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
    MappedParameter,
    MappedParameters,
    Parameter,
    Parameters,
    Value,
} from "@atomist/automation-client/lib/decorators";
import { Success } from "@atomist/automation-client/lib/HandlerResult";
import { GitHubRepoRef } from "@atomist/automation-client/lib/operations/common/GitHubRepoRef";
import { chooseAndSetGoals } from "@atomist/sdm/lib/api-helper/goal/chooseAndSetGoals";
import {
    slackSuccessMessage,
    slackWarningMessage,
} from "@atomist/sdm/lib/api-helper/misc/slack/messages";
import {
    GitBranchRegExp,
    GitShaRegExp,
} from "@atomist/sdm/lib/api/command/support/commonValidationPatterns";
import {
    CommandListener,
    CommandListenerInvocation,
} from "@atomist/sdm/lib/api/listener/CommandListener";
import { SoftwareDeliveryMachine } from "@atomist/sdm/lib/api/machine/SoftwareDeliveryMachine";
import { CommandHandlerRegistration } from "@atomist/sdm/lib/api/registration/CommandHandlerRegistration";
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

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo: string;

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

    @Parameter({ description: "Ref", ...GitShaRegExp, required: false })
    public sha: string;

    @Parameter({ description: "Branch", ...GitBranchRegExp, required: false })
    public branch: string;

    @Value("name")
    public name: string;

    @Value("version")
    public version: string;

}

export function resetGoalsCommand(
    sdm: SoftwareDeliveryMachine,
): CommandHandlerRegistration<ResetGoalsParameters> {

    return {
        name: "ResetGoalsOnCommit",
        description: "Plan goals on a commit",
        paramsMaker: ResetGoalsParameters,
        listener: resetGoalsOnCommit(sdm),
        intent: [
            `reset goals ${sdm.configuration.name.replace("@", "")}`,
            `plan goals ${sdm.configuration.name.replace("@", "")}`,
        ],
    };
}

function resetGoalsOnCommit(sdm: SoftwareDeliveryMachine): CommandListener<ResetGoalsParameters> {
    return async (cli: CommandListenerInvocation<ResetGoalsParameters>) => {

        const rules = {
            projectLoader: sdm.configuration.sdm.projectLoader,
            repoRefResolver: sdm.configuration.sdm.repoRefResolver,
            goalsListeners: [...sdm.goalsSetListeners],
            goalSetter: sdm.pushMapping,
            implementationMapping: sdm.goalFulfillmentMapper,
            preferencesFactory: sdm.configuration.sdm.preferenceStoreFactory,
        };

        const slug = `${cli.parameters.owner}/${cli.parameters.repo}`;
        let repoData;
        try {
            repoData = await fetchBranchTips(cli.context, {
                providerId: cli.parameters.providerId,
                owner: cli.parameters.owner,
                repo: cli.parameters.repo,
            });
        } catch (e) {
            const text = `Repository ${bold(slug)} not found`;
            return cli.context.messageClient.respond(slackWarningMessage("Set Goal State", text, cli.context));
        }
        const branch = cli.parameters.branch || repoData.defaultBranch;
        let sha;
        try {
            sha = cli.parameters.sha || tipOfBranch(repoData, branch);
        } catch (e) {
            return cli.context.messageClient.respond(
                slackWarningMessage(
                    "Set Goal State",
                    `Branch ${bold(branch)} not found on ${bold(slug)}`,
                    cli.context));
        }

        const id = GitHubRepoRef.from({
            owner: cli.parameters.owner,
            repo: cli.parameters.repo,
            sha,
            branch,
        });

        const push = await fetchPushForCommit(cli.context, id, cli.parameters.providerId);

        const goals = await chooseAndSetGoals(rules, {
            context: cli.context,
            credentials: cli.credentials,
            push,
        });

        const slugBranch = `${id.owner}/${id.repo}/${push.branch}`;
        if (goals) {
            await cli.addressChannels(slackSuccessMessage(
                "Plan Goals",
                `Successfully planned goals on ${codeLine(push.after.sha.slice(0, 7))} of ${bold(slugBranch)} to ${italic(goals.name)}`,
                {
                    footer: `${cli.parameters.name}:${cli.parameters.version}`,
                }));
        } else {
            await cli.addressChannels(slackWarningMessage(
                "Plan Goals",
                `No goals found for ${codeLine(push.after.sha.slice(0, 7))} of ${bold(slugBranch)}`,
                cli.context,
                {
                    footer: `${cli.parameters.name}:${cli.parameters.version}`,
                }));
        }

        return Success;
    };
}
