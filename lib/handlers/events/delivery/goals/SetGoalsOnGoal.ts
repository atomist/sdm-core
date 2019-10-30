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
    ConfigurationAware,
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
    addressChannelsFor,
    chooseAndSetGoals,
    CredentialsResolver,
    EnrichGoal,
    GoalImplementationMapper,
    GoalSetter,
    GoalsSetListener,
    NoPreferenceStore,
    PreferenceStoreFactory,
    ProjectLoader,
    PushListenerInvocation,
    RepoRefResolver,
    resolveCredentialsPromise,
    TagGoalSet,
} from "@atomist/sdm";
import {
    OnAnyCompletedSdmGoal,
    SdmGoalState,
} from "../../../../typings/types";

/**
 * Set up goalSet on a goal (e.g. for delivery).
 */
@EventHandler("Set up goalSet on Goal", GraphQL.subscription("OnAnyCompletedSdmGoal"))
export class SetGoalsOnGoal implements HandleEvent<OnAnyCompletedSdmGoal.Subscription> {

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
                private readonly preferenceStoreFactory: PreferenceStoreFactory,
                private readonly enrichGoal: EnrichGoal,
                private readonly tagGoalSet: TagGoalSet) {
    }

    public async handle(event: EventFired<OnAnyCompletedSdmGoal.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const goal = event.data.SdmGoal[0];

        // Don't pass in_process goals down into the tests
        if (goal.state === SdmGoalState.in_process) {
            return Success;
        }

        const push = goal.push;
        const id: RemoteRepoRef = this.repoRefResolver.toRemoteRepoRef(push.repo, {});
        const credentials = await resolveCredentialsPromise(this.credentialsFactory.eventHandlerCredentials(context, id));

        const addressChannels = addressChannelsFor(push.repo, context);
        const preferences = !!this.preferenceStoreFactory ? this.preferenceStoreFactory(context) : NoPreferenceStore;
        const configuration = (context as any as ConfigurationAware).configuration;

        const pli: PushListenerInvocation = {
            // Provide an undefined project to check if there is a goal test in the push rules
            project: undefined,
            credentials,
            id,
            push,
            context,
            addressChannels,
            configuration,
            preferences: preferences || NoPreferenceStore,
        };

        const matches = await this.goalSetter.mapping(pli);

        // When there are matches it means we have some goalTests that matched the goal
        if (!!matches && !!matches.goals && matches.goals.length > 0) {
            await chooseAndSetGoals({
                projectLoader: this.projectLoader,
                repoRefResolver: this.repoRefResolver,
                goalsListeners: this.goalsListeners,
                goalSetter: this.goalSetter,
                implementationMapping: this.implementationMapping,
                preferencesFactory: this.preferenceStoreFactory,
                enrichGoal: this.enrichGoal,
                tagGoalSet: this.tagGoalSet,
            }, {
                context,
                credentials,
                push,
            });
        }
        return Success;
    }
}