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

import { addressSlackUsers } from "@atomist/automation-client";
import { Destination } from "@atomist/automation-client/lib/spi/message/MessageClient";
import {
    actionableButton,
    CommandHandlerRegistration,
    ExtensionPack,
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
        const { completedGoal, context } = gi;

        const destinations: Destination[] = [];

        for (const destinationFactory of toArray(options.destination || [])) {
            const newDestinations = await destinationFactory(completedGoal, gi);
            if (!!newDestinations) {
                destinations.push(...toArray(newDestinations));
            }
        }

        if (destinations.length > 0) {
            let state: string;
            let msg: SlackMessage;
            switch (completedGoal.state) {
                case SdmGoalState.failure:
                    state = "has failed";
                    msg = slackErrorMessage("", "", context, {
                        actions: completedGoal.retryFeasible ? [
                            actionableButton({ text: "Restart" }, updateGoalCommand, {
                                id: (completedGoal as any).id,
                                state: SdmGoalState.requested,
                            })] : [],
                    });
                    break;
                case SdmGoalState.waiting_for_approval:
                    state = "is waiting for approval";
                    msg = slackInfoMessage("", "", {
                        actions: [actionableButton({ text: "Approve" }, updateGoalCommand, {
                            id: (completedGoal as any).id,
                            state: SdmGoalState.approved,
                        })],
                    });
                    break;
                case SdmGoalState.waiting_for_pre_approval:
                    state = "is waiting to start";
                    msg = slackInfoMessage("", "", {
                        actions: [actionableButton({ text: "Start" }, updateGoalCommand, {
                            id: (completedGoal as any).id,
                            state: SdmGoalState.pre_approved,
                        })],
                    });
                    break;
                case SdmGoalState.stopped:
                    state = "has stopped";
                    msg = slackInfoMessage("", "");
                    break;
                default:
                    return;
            }

            const title = `Goal ${state}`;
            const text = `Goal ${italic(completedGoal.url ? url(completedGoal.url, completedGoal.name) : completedGoal.name)} on ${
                codeLine(completedGoal.sha.slice(0, 7))} of ${bold(`${
                completedGoal.repo.owner}/${completedGoal.repo.name}/${completedGoal.branch}`)} ${state}.`;
            const channels: CoreRepoFieldsAndChannels.Channels[] = _.get(completedGoal, "push.repo.channels") || [];
            const channelLink = channels.filter(c => !!c.id).map(c => channel(c.id)).join(" | ");

            msg.attachments[0] = {
                ...msg.attachments[0],
                title,
                text,
                footer: `${slackFooter()} | ${completedGoal.goalSetId.slice(0, 7)} | ${channelLink}`,
            };

            for (const destination of destinations) {
                await context.messageClient.send(msg, destination);
            }
        }
    };
}
