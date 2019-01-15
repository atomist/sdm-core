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
    RemoteRepoRef,
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    chooseAndSetGoals,
    CredentialsResolver,
    GoalImplementationMapper,
    GoalSetter,
    GoalsSetListener,
    PreferenceStoreFactory,
    ProjectLoader,
    RepoRefResolver,
} from "@atomist/sdm";
import { OnPushToAnyBranch } from "../../../../typings/types";

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
                // public for tests only
                public readonly goalsListeners: GoalsSetListener[],
                private readonly implementationMapping: GoalImplementationMapper,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly preferenceStoreFactory: PreferenceStoreFactory) {
    }

    public async handle(event: EventFired<OnPushToAnyBranch.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const push: OnPushToAnyBranch.Push = event.data.Push[0];
        const id: RemoteRepoRef = this.repoRefResolver.toRemoteRepoRef(push.repo, {});
        const credentials = this.credentialsFactory.eventHandlerCredentials(context, id);

        await chooseAndSetGoals({
            projectLoader: this.projectLoader,
            repoRefResolver: this.repoRefResolver,
            goalsListeners: this.goalsListeners,
            goalSetter: this.goalSetter,
            implementationMapping: this.implementationMapping,
            preferencesFactory: this.preferenceStoreFactory,
        }, {
                context,
                credentials,
                push,
            });
        return Success;
    }
}
