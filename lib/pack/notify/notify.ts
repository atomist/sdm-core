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
    addressSlackUsers,
    guid,
} from "@atomist/automation-client";
import { Destination } from "@atomist/automation-client/lib/spi/message/MessageClient";
import {
    actionableButton,
    CommandHandlerRegistration,
    ExtensionPack,
    fetchGoalsForCommit,
    GoalCompletionListener,
    metadata,
    SdmContext,
    SdmGoalEvent,
    SdmGoalState,
    slackErrorMessage,
    slackFooter,
    slackInfoMessage,
} from "@atomist/sdm";
import {
    bold,
    channel,
    codeLine,
    italic,
    SlackMessage,
    url,
} from "@atomist/slack-messages";
import * as _ from "lodash";
import {
    CoreRepoFieldsAndChannels,
    PersonFields,
} from "../../typings/types";
import { toArray } from "../../util/misc/array";
import { updateGoalStateCommand } from "../goal-state/updateGoal";

export type DestinationFactory = (goal: SdmGoalEvent, context: SdmContext) => Promise<Destination | Destination[] | undefined>;

export interface NotifyOptions {
    destination: DestinationFactory | DestinationFactory[];
}

export function notify(options: NotifyOptions = { destination: defaultDestinationFactory }): ExtensionPack {
    return {
        ...metadata("notify"),
        configure: sdm => {

            const updateGoalCommand = updateGoalStateCommand();
            updateGoalCommand.name = `${updateGoalCommand.name}ForNotifications`;
            sdm.addCommand(updateGoalCommand);

            sdm.addGoalCompletionListener(notifyGoalCompletionListener(options, updateGoalCommand));
        },
    };
}

async function defaultDestinationFactory(goal: SdmGoalEvent): Promise<Destination | Destination[] | undefined> {
    if (goal.state === SdmGoalState.failure) {
        const recipient = _.get(goal, "push.after.committer.person.chatId") as PersonFields.ChatId;
        if (!!recipient) {
            return addressSlackUsers(recipient.chatTeam.id, recipient.screenName);
        }
    }
    return undefined;
}

function notifyGoalCompletionListener(options: NotifyOptions,
                                      updateGoalCommand: CommandHandlerRegistration): GoalCompletionListener {
    return async gi => {
        const { completedGoal, context, id } = gi;

        const destinations: Destination[] = [];

        for (const destinationFactory of toArray(options.destination || [])) {
            const newDestinations = await destinationFactory(completedGoal, gi);
            if (!!newDestinations) {
                destinations.push(...toArray(newDestinations));
            }
        }

        const goals = await fetchGoalsForCommit(context, id, completedGoal.repo.providerId, completedGoal.goalSetId);
        const goalId = (goals.find(g => g.uniqueName === completedGoal.uniqueName) as any).id;
        const msgId = guid();

        if (destinations.length > 0) {
            let state: string;
            let suffix: string;
            let msg: SlackMessage;
            switch (completedGoal.state) {
                case SdmGoalState.failure:
                    state = "has failed";
                    suffix = "Failed";
                    msg = slackErrorMessage("", "", context, {
                        actions: completedGoal.retryFeasible ? [
                            actionableButton({ text: "Restart" }, updateGoalCommand, {
                                id: goalId,
                                msgId,
                                state: SdmGoalState.requested,
                            })] : [],
                    });
                    break;
                case SdmGoalState.waiting_for_approval:
                    state = "is waiting for approval";
                    suffix = "Awaiting Approval";
                    msg = slackInfoMessage("", "", {
                        actions: [actionableButton({ text: "Approve" }, updateGoalCommand, {
                            id: goalId,
                            msgId,
                            state: SdmGoalState.approved,
                        })],
                    });
                    break;
                case SdmGoalState.waiting_for_pre_approval:
                    state = "is waiting to start";
                    suffix = "Awaiting Start";
                    msg = slackInfoMessage("", "", {
                        actions: [actionableButton({ text: "Start" }, updateGoalCommand, {
                            id: goalId,
                            msgId,
                            state: SdmGoalState.pre_approved,
                        })],
                    });
                    break;
                case SdmGoalState.stopped:
                    state = "has stopped";
                    suffix = "Stopped";
                    msg = slackInfoMessage("", "");
                    break;
                default:
                    return;
            }

            const author = `Goal ${suffix}`;
            const text = `Goal ${italic(completedGoal.url ? url(completedGoal.url, completedGoal.name) : completedGoal.name)} on ${
                codeLine(completedGoal.sha.slice(0, 7))} of ${bold(`${
                completedGoal.repo.owner}/${completedGoal.repo.name}/${completedGoal.branch}`)} ${state}.`;
            const channels: CoreRepoFieldsAndChannels.Channels[] = _.get(completedGoal, "push.repo.channels") || [];
            const channelLink = channels.filter(c => !!c.channelId).map(c => channel(c.channelId)).join(" | ");
            const link =
                `https://app.atomist.com/workspace/${context.workspaceId}/goalset/${completedGoal.goalSetId}`;

            msg.attachments[0] = {
                ...msg.attachments[0],
                author_name: author,
                text,
                footer: `${slackFooter()} | ${url(link, completedGoal.goalSetId.slice(0, 7))} | ${channelLink}`,
            };

            for (const destination of destinations) {
                await context.messageClient.send(msg, destination, { id: msgId });
            }
        }
    };
}
