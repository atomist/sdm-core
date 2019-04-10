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
    addressEvent,
    AutomationContextAware,
    MappedParameters,
    QueryNoCacheOptions,
    Success,
} from "@atomist/automation-client";
import {
    CommandHandlerRegistration,
    DeclarationType,
    SdmGoalState,
    slackErrorMessage,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import * as _ from "lodash";
import {
    SdmGoalById,
    SdmGoalFields,
} from "../../typings/types";

export function updateGoalStateCommand(): CommandHandlerRegistration<{
    id: string,
    state: SdmGoalState,
    slackRequester: string,
    githubRequester: string,
    teamId: string,
    channelId: string,
}> {
    return {
        name: "UpdateGoalStateCommand",
        description: "Update goal state",
        parameters: {
            id: {},
            state: {},
            slackRequester: {
                uri: MappedParameters.SlackUserName,
                required: false,
                declarationType: DeclarationType.Mapped,
            },
            githubRequester: {
                uri: MappedParameters.GitHubUserLogin,
                required: false,
                declarationType: DeclarationType.Mapped,
            },
            teamId: { uri: MappedParameters.SlackTeam, required: false, declarationType: DeclarationType.Mapped },
            channelId: { uri: MappedParameters.SlackChannel, required: false, declarationType: DeclarationType.Mapped },
        },
        listener: async ci => {
            const goalResult = await ci.context.graphClient.query<SdmGoalById.Query, SdmGoalById.Variables>({
                name: "SdmGoalById",
                variables: {
                    id: ci.parameters.id,
                },
                options: QueryNoCacheOptions,
            });

            if (!goalResult || !goalResult.SdmGoal[0]) {
                await ci.context.messageClient.respond(
                    slackErrorMessage(`Update Goal State`, "Provided goal does not exist", ci.context));
                return Success;
            }

            const goal = _.cloneDeep(goalResult.SdmGoal[0]);
            const actx = ci.context as any as AutomationContextAware;

            const prov: SdmGoalFields.Provenance = {
                name: actx.context.operation,
                registration: actx.context.name,
                version: actx.context.version,
                correlationId: actx.context.correlationId,
                ts: Date.now(),
                channelId: ci.parameters.channelId,
                userId: ci.parameters.slackRequester ? ci.parameters.slackRequester : ci.parameters.githubRequester,
            };

            goal.provenance = [
                ...goal.provenance,
                prov,
            ];

            // Don't set approval for restart updates
            if (ci.parameters.state === SdmGoalState.approved) {
                goal.approval = prov;
                goal.approvalRequired = false;
            } else if (ci.parameters.state === SdmGoalState.pre_approved) {
                goal.preApproval = prov;
                goal.preApprovalRequired = false;
            }

            goal.state = ci.parameters.state;
            goal.ts = Date.now();
            goal.version = (goal.version || 0) + 1;
            delete (goal as any).id;

            return ci.context.messageClient.send(goal, addressEvent("SdmGoal"));
        },
    };
}
