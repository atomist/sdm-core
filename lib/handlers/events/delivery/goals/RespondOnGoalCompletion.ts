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
    EventHandler,
    Value,
} from "@atomist/automation-client/lib/decorators";
import { automationClientInstance } from "@atomist/automation-client/lib/globals";
import { subscription } from "@atomist/automation-client/lib/graph/graphQL";
import {
    EventFired,
    HandleEvent,
} from "@atomist/automation-client/lib/HandleEvent";
import { HandlerContext } from "@atomist/automation-client/lib/HandlerContext";
import {
    HandlerResult,
    Success,
} from "@atomist/automation-client/lib/HandlerResult";
import { logger } from "@atomist/automation-client/lib/util/logger";
import { fetchGoalsFromPush } from "@atomist/sdm/lib/api-helper/goal/fetchGoalsOnCommit";
import { resolveCredentialsPromise } from "@atomist/sdm/lib/api-helper/machine/handlerRegistrations";
import { addressChannelsFor } from "@atomist/sdm/lib/api/context/addressChannels";
import { PreferenceStoreFactory } from "@atomist/sdm/lib/api/context/preferenceStore";
import { createSkillContext } from "@atomist/sdm/lib/api/context/skillConfiguration";
import { SdmGoalEvent } from "@atomist/sdm/lib/api/goal/SdmGoalEvent";
import {
    GoalCompletionListener,
    GoalCompletionListenerInvocation,
} from "@atomist/sdm/lib/api/listener/GoalCompletionListener";
import { SoftwareDeliveryMachineConfiguration } from "@atomist/sdm/lib/api/machine/SoftwareDeliveryMachineOptions";
import { CredentialsResolver } from "@atomist/sdm/lib/spi/credentials/CredentialsResolver";
import { RepoRefResolver } from "@atomist/sdm/lib/spi/repo-ref/RepoRefResolver";
import * as stringify from "json-stringify-safe";
import { shouldHandle } from "../../../../internal/delivery/goals/support/validateGoal";
import { verifyGoal } from "../../../../internal/signing/goalSigning";
import { OnAnyCompletedSdmGoal } from "../../../../typings/types";

/**
 * Respond to a failure or success status by running listeners
 */
@EventHandler("Run a listener on goal failure or success",
    () => subscription({
        name: "OnAnyCompletedSdmGoal",
        variables: { registration: () => [automationClientInstance()?.configuration?.name] },
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
            skill: createSkillContext(context),
        };

        try {
            await Promise.all(this.goalCompletionListeners.map(l => l(gsi)));
        } catch (e) {
            logger.warn(`Error occurred while running goal completion listener: ${stringify(e)}`);
        }
        return Success;
    }
}
