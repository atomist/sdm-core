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
    EventFired,
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    CredentialsResolver,
    fetchGoalsFromPush,
    GoalImplementationMapper,
    goalKeyString,
    mapKeyToGoal,
    preconditionsAreMet,
    PreferenceStoreFactory,
    RepoRefResolver,
    SdmGoalEvent,
    SdmGoalFulfillmentMethod,
    SdmGoalKey,
    updateGoal,
} from "@atomist/sdm";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import {
    OnAnySuccessfulSdmGoal,
    SdmGoalState,
} from "../../../../typings/types";

/**
 * Move downstream goals from 'planned' to 'requested' when preconditions are met.
 */
@EventHandler("Move downstream goals from 'planned' to 'requested' when preconditions are met",
    GraphQL.subscription("OnAnySuccessfulSdmGoal"))
export class RequestDownstreamGoalsOnGoalSuccess implements HandleEvent<OnAnySuccessfulSdmGoal.Subscription> {

    constructor(private readonly name: string,
                private readonly implementationMapper: GoalImplementationMapper,
                private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsResolver: CredentialsResolver,
                private readonly preferenceStoreFactory: PreferenceStoreFactory) {
    }

    public async handle(event: EventFired<OnAnySuccessfulSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const sdmGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.uniqueName} skipped because not relevant for this SDM`);
            return Success;
        }

        const id = this.repoRefResolver.repoRefFromPush(sdmGoal.push);
        const credentials = this.credentialsResolver.eventHandlerCredentials(context, id);
        const preferences = this.preferenceStoreFactory(context);

        const goals = fetchGoalsFromPush(sdmGoal);

        const goalsToRequest = goals.filter(g => isDirectlyDependentOn(sdmGoal, g))
            .filter(g => expectToBeFulfilledAfterRequest(g, this.name))
            .filter(shouldBePlannedOrSkipped)
            .filter(g => preconditionsAreMet(g, { goalsForCommit: goals }));

        if (goalsToRequest.length > 0) {
            logger.info("because %s is successful, these goals are now ready: %s", goalKeyString(sdmGoal),
                goalsToRequest.map(goalKeyString).join(", "));
        }

        await Promise.all(goalsToRequest.map(async sdmG => {
            const goal = this.implementationMapper.findGoalBySdmGoal(sdmG);
            if (sdmG.preApprovalRequired) {
                return updateGoal(context, sdmG, {
                    state: SdmGoalState.waiting_for_pre_approval,
                    description: goal ? goal.waitingForPreApprovalDescription : `Start required: ${sdmG.name}`,
                });
            } else {
                let g = sdmG;
                const cbs = this.implementationMapper.findFulfillmentCallbackForGoal(sdmG);
                for (const cb of cbs) {
                    g = await cb.callback(g, { id, addressChannels: undefined, preferences, credentials, context });
                }
                return updateGoal(context, g, {
                    state: SdmGoalState.requested,
                    description: goal ? goal.requestedDescription : `Ready: ${g.name}`,
                    data: g.data,
                });
            }
        }));
        return Success;
    }
}

function shouldBePlannedOrSkipped(dependentGoal: SdmGoalEvent): boolean {
    if (dependentGoal.state === SdmGoalState.planned) {
        return true;
    }
    if (dependentGoal.state === SdmGoalState.skipped) {
        logger.info("Goal %s was skipped, but now maybe it can go", dependentGoal.uniqueName);
        return true;
    }
    if (dependentGoal.state === SdmGoalState.failure && dependentGoal.retryFeasible) {
        logger.info("Goal %s failed, but maybe we will retry it", dependentGoal.uniqueName);
        return true;
    }
    logger.warn("Goal %s in state %s will not be requested", dependentGoal.uniqueName, dependentGoal.state);
    return false;
}

function expectToBeFulfilledAfterRequest(dependentGoal: SdmGoalEvent, name: string): boolean {
    switch (dependentGoal.fulfillment.method) {
        case SdmGoalFulfillmentMethod.Sdm:
            return true;
        case SdmGoalFulfillmentMethod.SideEffect:
            return dependentGoal.fulfillment.name !== name;
        case SdmGoalFulfillmentMethod.Other:
            // legacy behavior
            return true;
    }
}

function isDirectlyDependentOn(successfulGoal: SdmGoalKey, goal: SdmGoalEvent): boolean {
    if (!goal) {
        logger.warn("Internal error: Trying to work out if %j is dependent on null or undefined goal", successfulGoal);
        return false;
    }
    if (!goal.preConditions || goal.preConditions.length === 0) {
        return false; // no preconditions? not dependent
    }
    if (mapKeyToGoal(goal.preConditions)(successfulGoal)) {
        logger.debug("%s depends on %s", goal.uniqueName, successfulGoal.uniqueName);
        return true; // the failed goal is one of my preconditions? dependent
    }
    return false;
}
