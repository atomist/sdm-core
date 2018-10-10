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
    GraphQL,
    HandlerContext,
    HandlerResult,
    logger,
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    BuildStatus,
    descriptionFromState,
    findSdmGoalOnCommit,
    Goal,
    RepoRefResolver,
    SdmGoalEvent,
    SdmGoalFulfillmentMethod,
    SdmGoalState,
    updateGoal,
} from "@atomist/sdm";
import { OnBuildComplete } from "../../../../typings/types";

/**
 * Set build status on complete build
 */
// TODO CD move to sdm-pack-build
@EventHandler("Set build goal to successful on build complete, if it's side-effecting",
    GraphQL.subscription("OnBuildComplete"))
export class SetGoalOnBuildComplete implements HandleEvent<OnBuildComplete.Subscription> {

    constructor(private readonly buildGoals: Goal[],
                private readonly repoRefResolver: RepoRefResolver) {
    }

    public async handle(event: EventFired<OnBuildComplete.Subscription>,
                        ctx: HandlerContext, params: this): Promise<HandlerResult> {
        const build = event.data.Build[0];
        const commit: OnBuildComplete.Commit = build.commit;

        const id = params.repoRefResolver.toRemoteRepoRef(commit.repo, { sha: commit.sha });
        for (const buildGoal of params.buildGoals) {
            const sdmGoal = await findSdmGoalOnCommit(ctx, id, commit.repo.org.provider.providerId, buildGoal);
            if (!sdmGoal) {
                logger.debug("No build goal on commit; ignoring someone else's build result");
                return Success;
            }
            if (sdmGoal.fulfillment.method !== SdmGoalFulfillmentMethod.SideEffect &&
                sdmGoal.fulfillment.method !== SdmGoalFulfillmentMethod.Other) {
                logger.debug("This build goal is not set up to be completed based on the build node. %j",
                    sdmGoal.fulfillment);
                return Success;
            }
            logger.info("Updating build goal: %s", buildGoal.context);
            await setBuiltContext(ctx, buildGoal, sdmGoal,
                build.status,
                build.buildUrl);
        }

        return Success;
    }
}

function buildStatusToSdmGoalState(buildStatus: BuildStatus): SdmGoalState {
    switch (buildStatus) {
        case "passed":
            return SdmGoalState.success;
        case "broken":
        case "failed":
        case "canceled":
            return SdmGoalState.failure;
        default:
            return SdmGoalState.in_process;
    }
}

async function setBuiltContext(ctx: HandlerContext,
                               goal: Goal,
                               sdmGoal: SdmGoalEvent,
                               state: BuildStatus,
                               url: string): Promise<any> {
    const newState = buildStatusToSdmGoalState(state);
    return updateGoal(ctx, sdmGoal,
        {
            url,
            state: newState,
            description: descriptionFromState(goal, newState),
        });
}
