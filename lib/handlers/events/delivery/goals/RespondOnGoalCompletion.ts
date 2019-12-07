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
    automationClientInstance,
    EventFired,
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
    Value,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    addressChannelsFor,
    CredentialsResolver,
    fetchGoalsFromPush,
    GoalCompletionListener,
    GoalCompletionListenerInvocation,
    PreferenceStoreFactory,
    RepoRefResolver,
    resolveCredentialsPromise,
    SdmGoalEvent,
    SoftwareDeliveryMachineConfiguration,
} from "@atomist/sdm";
import * as stringify from "json-stringify-safe";
import { shouldHandle } from "../../../../internal/delivery/goals/support/validateGoal";
import { verifyGoal } from "../../../../internal/signing/goalSigning";
import { OnAnyCompletedSdmGoal } from "../../../../typings/types";

/**
 * Respond to a failure or success status by running listeners
 */
@EventHandler("Run a listener on goal failure or success",
    () => GraphQL.subscription({
        name: "OnAnyCompletedSdmGoal",
        variables: { registration: () => automationClientInstance()?.configuration?.name },
    }))
export class RespondOnGoalCompletion implements HandleEvent<OnAnyCompletedSdmGoal.Subscription> {

    @Value("")
    public configuration: SoftwareDeliveryMachineConfiguration;

    constructor(private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly goalCompletionListeners: GoalCompletionListener[],
                private readonly preferenceStoreFactory: PreferenceStoreFactory) {
    }

    public async handle(event: EventFired<OnAnyCompletedSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const sdmGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!shouldHandle(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.uniqueName} skipped because not managed by this SDM`);
            return Success;
        }

        await verifyGoal(sdmGoal, this.configuration.sdm.goalSigning, context);

        const id = this.repoRefResolver.repoRefFromPush(sdmGoal.push);

        const goals = fetchGoalsFromPush(sdmGoal);

        const gsi: GoalCompletionListenerInvocation = {
            id,
            context,
            credentials: await resolveCredentialsPromise(this.credentialsFactory.eventHandlerCredentials(context, id)),
            addressChannels: addressChannelsFor(sdmGoal.push.repo, context),
            configuration: this.configuration,
            preferences: this.preferenceStoreFactory(context),
            allGoals: goals,
            completedGoal: sdmGoal,
        };

        try {
            await Promise.all(this.goalCompletionListeners.map(l => l(gsi)));
        } catch (e) {
            logger.warn(`Error occurred while running goal completion listener: ${stringify(e)}`);
        }
        return Success;
    }
}
