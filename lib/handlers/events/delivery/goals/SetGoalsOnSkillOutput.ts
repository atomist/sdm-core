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

import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { subscription } from "@atomist/automation-client/lib/graph/graphQL";
import {
    EventFired,
    HandleEvent,
} from "@atomist/automation-client/lib/HandleEvent";
import {
    ConfigurationAware,
    HandlerContext,
} from "@atomist/automation-client/lib/HandlerContext";
import {
    HandlerResult,
    Success,
} from "@atomist/automation-client/lib/HandlerResult";
import { RemoteRepoRef } from "@atomist/automation-client/lib/operations/common/RepoId";
import { chooseAndSetGoals } from "@atomist/sdm/lib/api-helper/goal/chooseAndSetGoals";
import { resolveCredentialsPromise } from "@atomist/sdm/lib/api-helper/machine/handlerRegistrations";
import { addressChannelsFor } from "@atomist/sdm/lib/api/context/addressChannels";
import {
    NoPreferenceStore,
    PreferenceStoreFactory,
} from "@atomist/sdm/lib/api/context/preferenceStore";
import { createSkillContext } from "@atomist/sdm/lib/api/context/skillConfiguration";
import { EnrichGoal } from "@atomist/sdm/lib/api/goal/enrichGoal";
import { GoalImplementationMapper } from "@atomist/sdm/lib/api/goal/support/GoalImplementationMapper";
import { TagGoalSet } from "@atomist/sdm/lib/api/goal/tagGoalSet";
import { GoalsSetListener } from "@atomist/sdm/lib/api/listener/GoalsSetListener";
import { PushListenerInvocation } from "@atomist/sdm/lib/api/listener/PushListener";
import { GoalSetter } from "@atomist/sdm/lib/api/mapping/GoalSetter";
import { CredentialsResolver } from "@atomist/sdm/lib/spi/credentials/CredentialsResolver";
import { ProjectLoader } from "@atomist/sdm/lib/spi/project/ProjectLoader";
import { RepoRefResolver } from "@atomist/sdm/lib/spi/repo-ref/RepoRefResolver";
import { CacheInputGoalDataKey } from "../../../../goal/cache/goalCaching";
import {
    OnAnySkillOutput,
    SkillOutput,
} from "../../../../typings/types";

/**
 * Set up goalSet on a goal (e.g. for delivery).
 */
@EventHandler("Set up goalSet on SkillOutput", subscription({
    name: "OnAnySkillOutput",
    variables: { registration: undefined },
}))
export class SetGoalsOnSkillOutput implements HandleEvent<OnAnySkillOutput.Subscription> {

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

    public async handle(event: EventFired<OnAnySkillOutput.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const output = event.data.SkillOutput[0];

        const push = output.push;
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
            skill: createSkillContext(context),
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
                enrichGoal: addSkillOutputAsInputEnrichGoal(output, this.enrichGoal),
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

/**
 * Add a SkillOutput to the scheduled goals input
 */
function addSkillOutputAsInputEnrichGoal(skillOutput: SkillOutput,
                                         delegate: EnrichGoal = async g => g): EnrichGoal {
    return async (goal, pli) => {
        const input: Array<{ classifier: string }> = goal.parameters[CacheInputGoalDataKey] || [];
        input.push({ classifier: skillOutput.classifier });
        goal.parameters[CacheInputGoalDataKey] = input;
        return delegate(goal, pli);
    }
}
