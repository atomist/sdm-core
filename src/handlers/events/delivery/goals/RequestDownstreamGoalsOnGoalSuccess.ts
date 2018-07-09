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
    EventFired,
    EventHandler,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
    Value,
} from "@atomist/automation-client";
import { subscription } from "@atomist/automation-client/graph/graphQL";
import { SdmGoalEvent } from "@atomist/sdm";
import { fetchGoalsForCommit } from "@atomist/sdm/api-helper/goal/fetchGoalsOnCommit";
import { preconditionsAreMet } from "@atomist/sdm/api-helper/goal/goalPreconditions";
import { goalKeyString } from "@atomist/sdm/api-helper/goal/sdmGoal";
import { updateGoal } from "@atomist/sdm/api-helper/goal/storeGoals";
import { SdmGoalKey } from "@atomist/sdm/api/goal/SdmGoal";
import { SdmGoalImplementationMapper } from "@atomist/sdm/api/goal/support/SdmGoalImplementationMapper";
import { RepoRefResolver } from "@atomist/sdm/spi/repo-ref/RepoRefResolver";
import * as _ from "lodash";
import { isGoalRelevant } from "../../../../internal/delivery/goals/support/validateGoal";
import {
    OnAnySuccessfulSdmGoal,
    ScmProvider,
    SdmGoalState,
} from "../../../../typings/types";

/**
 * Respond to a failure status by failing downstream goals
 */
@EventHandler("Move downstream goals from 'planned' to 'success' when preconditions are met",
    subscription("OnAnySuccessfulSdmGoal"))
export class RequestDownstreamGoalsOnGoalSuccess implements HandleEvent<OnAnySuccessfulSdmGoal.Subscription> {

    @Value("token")
    public githubToken: string;

    constructor(private readonly name,
                private readonly implementationMapper: SdmGoalImplementationMapper,
                private readonly repoRefResolver: RepoRefResolver) {
    }

    // #98: GitHub Status->SdmGoal: I believe all the goal state updates in this SDM
    // are now happening on the SdmGoal. This subscription can change to be on SdmGoal state.
    public async handle(event: EventFired<OnAnySuccessfulSdmGoal.Subscription>,
                        context: HandlerContext,
                        params: this): Promise<HandlerResult> {
        const sdmGoal = event.data.SdmGoal[0] as SdmGoalEvent;

        if (!isGoalRelevant(sdmGoal)) {
            logger.debug(`Goal ${sdmGoal.name} skipped because not relevant for this SDM`);
            return Success;
        }

        const id = params.repoRefResolver.repoRefFromSdmGoal(sdmGoal, await fetchScmProvider(context, sdmGoal.repo.providerId));
        const goals: SdmGoalEvent[] = sumSdmGoalEventsByOverride(
            await fetchGoalsForCommit(context, id, sdmGoal.repo.providerId, sdmGoal.goalSetId) as SdmGoalEvent[], [sdmGoal]);

        let goalsToRequest = goals.filter(g => isDirectlyDependentOn(sdmGoal, g));
        goalsToRequest = goalsToRequest.filter(g => expectToBeFulfilledAfterRequest(g, this.name));
        goalsToRequest = goalsToRequest.filter(shouldBePlannedOrSkipped);
        goalsToRequest = goalsToRequest.filter(g => preconditionsAreMet(g, {goalsForCommit: goals}));

        if (goalsToRequest.length > 0) {
            logger.info("because %s is successful, these goals are now ready: %s", goalKeyString(sdmGoal),
                goalsToRequest.map(goalKeyString).join(", "));
        }

        const credentials = {token: this.githubToken};

        /*
         * #294 Intention: for custom descriptions per goal, we need to look up the Goal.
         * This is the only reason to do that here.
         * I want to maintain a list in the SDM of all goals that can be assigned by rules,
         * and pass them here for mapping from SdmGoalKey -> Goal. Then, we can use
         * the requestDescription defined on that Goal.
         */
        await Promise.all(goalsToRequest.map(async goal => {
            const cbs = this.implementationMapper.findFulfillmentCallbackForGoal(goal);
            let g = goal;
            for (const cb of cbs) {
                g = await cb.callback(g, {id, addressChannels: undefined, credentials, context});
            }

            return updateGoal(context, g, {
                state: SdmGoalState.requested,
                description: `Ready to ` + g.name,
                data: g.data,
            });
        }));
        return Success;
    }
}

export function sumSdmGoalEventsByOverride(some: SdmGoalEvent[], more: SdmGoalEvent[]): SdmGoalEvent[] {
    // For some reason this won't compile with the obvious fix
    // tslint:disable-next-line:no-unnecessary-callback-wrapper
    const byKey = _.groupBy(some.concat(more), sg => goalKeyString(sg));
    const summedGoals = Object.keys(byKey).map(k => sumEventsForOneSdmGoal(byKey[k]));
    return summedGoals;
}

function sumEventsForOneSdmGoal(events: SdmGoalEvent[]): SdmGoalEvent {
    if (events.length === 1) {
        return events[0];
    }
    // here, I could get clever and sort by timestamp, or someday build a graph if they link to prior versions,
    // or get smart about statuses. Let me be lazy.
    logger.debug("Found %d events for %s. Taking the last one, which has state %s", events.length, goalKeyString(events[0]),
        events[events.length - 1].state);
    return events[events.length - 1];
}

export async function fetchScmProvider(context: HandlerContext, providerId: string): Promise<ScmProvider.ScmProvider> {
    const result = await context.graphClient.query<ScmProvider.Query, ScmProvider.Variables>(
        {name: "SCMProvider", variables: {providerId}});
    if (!result || !result.SCMProvider || result.SCMProvider.length === 0) {
        throw new Error(`Provider not found: ${providerId}`);
    }
    return result.SCMProvider[0];
}

function shouldBePlannedOrSkipped(dependentGoal: SdmGoalEvent) {
    if (dependentGoal.state === "planned") {
        return true;
    }
    if (dependentGoal.state === "skipped") {
        logger.info("Goal %s was skipped, but now maybe it can go", dependentGoal.name);
        return true;
    }
    if (dependentGoal.state === "failure" && dependentGoal.retryFeasible) {
        logger.info("Goal %s failed, but maybe we will retry it", dependentGoal.name);
        return true;
    }
    logger.warn("Goal %s in state %s will not be requested", dependentGoal.name, dependentGoal.state);
    return false;
}

function expectToBeFulfilledAfterRequest(dependentGoal: SdmGoalEvent, name: string) {
    switch (dependentGoal.fulfillment.method) {
        case "SDM fulfill on requested":
            return true;
        case "side-effect":
            const fulfilledOutsideSDM = dependentGoal.fulfillment.name !== name;
            return fulfilledOutsideSDM;
        case "other":
            // legacy behavior
            return true;
    }
}

function mapKeyToGoal<T extends SdmGoalKey>(goals: T[]): (SdmGoalKey) => T {
    return (keyToFind: SdmGoalKey) => {
        const found = goals.find(g =>
            g.environment === keyToFind.environment &&
            g.name === keyToFind.name);
        return found;
    };
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
        logger.debug("%s depends on %s", goal.name, successfulGoal.name);
        return true; // the failed goal is one of my preconditions? dependent
    }
    return false;
}
