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
    MappedParameter,
    MappedParameters,
    Parameter,
    Parameters,
    Value,
} from "@atomist/automation-client";
import { guid } from "@atomist/automation-client/internal/util/string";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import {
    buttonForCommand,
    menuForCommand,
} from "@atomist/automation-client/spi/message/MessageClient";
import {
    CommandHandlerRegistration,
    ExtensionPack,
    SdmGoalState,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import { fetchGoalsForCommit } from "@atomist/sdm/api-helper/goal/fetchGoalsOnCommit";
import { updateGoal } from "@atomist/sdm/api-helper/goal/storeGoals";
import { success } from "@atomist/sdm/api-helper/misc/slack/messages";
import {
    bold,
    codeLine,
    italic,
    SlackMessage,
} from "@atomist/slack-messages";
import * as _ from "lodash";
import { fetchBranchTips, tipOfBranch } from "../../util/graph/queryCommits";

@Parameters()
class SetGoalStateParameters {

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

    @Parameter({ required: false })
    public goal: string;

    @Parameter({ required: false })
    public state: SdmGoalState;

    @Parameter({ required: false })
    public msgId: string;

    @Parameter({ required: false, type: "boolean" })
    public cancel: boolean;

    @Value("name")
    public name: string;

    @Value("version")
    public version: string;

}

export function setGoalStateCommand(sdm: SoftwareDeliveryMachine): CommandHandlerRegistration<SetGoalStateParameters> {
    return {
        name: "SetGoalState",
        description: "Set state of a particular goal",
        intent: [`set goal state ${sdm.configuration.name.replace("@", "")}`, "set goal state"],
        paramsMaker: SetGoalStateParameters,
        listener: async chi => {
            if (!chi.parameters.msgId) {
                chi.parameters.msgId = guid();
            }
            const footer = `${chi.parameters.name}:${chi.parameters.version}`;
            const repoData = await fetchBranchTips(chi.context, chi.parameters);
            const branch = chi.parameters.branch || repoData.defaultBranch;
            const sha = chi.parameters.sha || tipOfBranch(repoData, branch);
            const id = GitHubRepoRef.from({ owner: chi.parameters.owner, repo: chi.parameters.repo, sha, branch });

            if (chi.parameters.cancel) {
                return chi.context.messageClient.respond(
                    success(
                        "Set Goal State",
                        "Successfully canceled setting goal state",
                        { footer }),
                    { id: chi.parameters.msgId });
            } else if (!chi.parameters.goal) {

                const goals = await fetchGoalsForCommit(chi.context, id, chi.parameters.providerId);
                const goalSets = _.groupBy(goals, "goalSetId");
                const optionsGroups = _.map(goalSets, (v, k) => {
                    return {
                        text: k.slice(0, 7),
                        options: v.map(g => ({
                            text: g.name,
                            value: JSON.stringify({ id: (g as any).id, name: g.name }),
                        })),
                    };
                });

                const msg: SlackMessage = {
                    attachments: [{
                        title: "Select Goal",
                        text: `Please select one of the following goals on ${
                            codeLine(sha.slice(0, 7))} of ${bold(`${id.owner}/${id.repo}/${branch}`)}:`,
                        actions: [
                            menuForCommand({
                                text: "Goals",
                                options: optionsGroups,
                            },
                                "SetGoalState",
                                "goal",
                                { ...chi.parameters }),
                            buttonForCommand(
                                { text: "Cancel" },
                                "SetGoalState",
                                { ...chi.parameters, cancel: true }),
                        ],
                        fallback: "Select Goal",
                        footer,
                    }],
                };
                return chi.context.messageClient.respond(msg, { id: chi.parameters.msgId });
            } else if (!chi.parameters.state) {
                const goal = JSON.parse(chi.parameters.goal);

                const msg: SlackMessage = {
                    attachments: [{
                        title: "Select Goal State",
                        text: `Please select the desired state of goal ${italic(goal.name)} on ${codeLine(sha.slice(0, 7))} of ${
                            bold(`${id.owner}/${id.repo}/${branch}`)}:`,
                        actions: [
                            menuForCommand({
                                text: "Goal States",
                                options: _.map(SdmGoalState, v => ({ text: v, value: v })),
                            }, "SetGoalState", "state", { ...chi.parameters }),
                            buttonForCommand(
                                { text: "Cancel" },
                                "SetGoalState",
                                { ...chi.parameters, cancel: true }),
                        ],
                        fallback: "Select Goal",
                        footer,
                    }],
                };
                return chi.context.messageClient.respond(msg, { id: chi.parameters.msgId });
            } else {
                const goal = JSON.parse(chi.parameters.goal);
                const goals = await fetchGoalsForCommit(chi.context, id, chi.parameters.providerId);
                const sdmGoal = goals.find(g => (g as any).id === goal.id);

                await updateGoal(chi.context, sdmGoal, {
                    state: chi.parameters.state,
                    description: sdmGoal.description,
                });

                return chi.context.messageClient.respond(
                    success(
                        "Set Goal State",
                        `Successfully set state of ${italic(goal.name)} on ${codeLine(sha.slice(0, 7))} of ${
                        bold(`${id.owner}/${id.repo}`)} to ${italic(chi.parameters.state)}`,
                        { footer }),
                    { id: chi.parameters.msgId });
            }

        },
    };
}
