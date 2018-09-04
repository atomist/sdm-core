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
    GraphQL,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    Success,
} from "@atomist/automation-client";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { chooseAndSetGoals } from "@atomist/sdm/api-helper/goal/chooseAndSetGoals";
import { GoalImplementationMapper } from "@atomist/sdm/api/goal/support/GoalImplementationMapper";
import { GoalsSetListener } from "@atomist/sdm/api/listener/GoalsSetListener";
import { GoalSetter } from "@atomist/sdm/api/mapping/GoalSetter";
import { CredentialsResolver } from "@atomist/sdm/spi/credentials/CredentialsResolver";
import { ProjectLoader } from "@atomist/sdm/spi/project/ProjectLoader";
import { RepoRefResolver } from "@atomist/sdm/spi/repo-ref/RepoRefResolver";
import { OnPushToAnyBranch } from "@atomist/sdm/typings/types";

/**
 * Set up goalSet on a push (e.g. for delivery).
 */
@EventHandler("Set up goalSet", GraphQL.subscription("OnPushToAnyBranch"))
export class SetGoalsOnPush implements HandleEvent<OnPushToAnyBranch.Subscription> {

    /**
     * Configure goal setting
     * @param projectLoader use to load projects
     * @param repoRefResolver used to resolve repos from GraphQL return
     * @param goalSetter
     * @param goalsListeners listener to goals set
     * @param implementationMapping
     * @param credentialsFactory credentials factory
     */
    constructor(private readonly projectLoader: ProjectLoader,
        private readonly repoRefResolver: RepoRefResolver,
        private readonly goalSetter: GoalSetter,
        public readonly goalsListeners: GoalsSetListener[],
        private readonly implementationMapping: GoalImplementationMapper,
        private readonly credentialsFactory: CredentialsResolver) {
    }

    public async handle(event: EventFired<OnPushToAnyBranch.Subscription>,
        context: HandlerContext,
        params: this): Promise<HandlerResult> {
        const push: OnPushToAnyBranch.Push = event.data.Push[0];
        const id: RemoteRepoRef = this.repoRefResolver.toRemoteRepoRef(push.repo, {});
        const credentials = this.credentialsFactory.eventHandlerCredentials(context, id);

        await chooseAndSetGoals({
            projectLoader: params.projectLoader,
            repoRefResolver: params.repoRefResolver,
            goalsListeners: params.goalsListeners,
            goalSetter: params.goalSetter,
            implementationMapping: params.implementationMapping,
        }, {
                context,
                credentials,
                push,
            });
        return Success;
    }
}
