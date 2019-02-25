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
    Configuration,
    EventFired,
    GraphQL,
    HandlerContext,
    HandlerResult,
    Success,
    Value,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    AddressNoChannels,
    CredentialsResolver,
    PreferenceStoreFactory,
    RepoCreationListener,
    RepoCreationListenerInvocation,
    RepoRefResolver,
    resolveCredentialsPromise,
} from "@atomist/sdm";
import * as schema from "../../../typings/types";

/**
 * A new repo has been created. We don't know if it has code.
 */
@EventHandler("On repo creation", GraphQL.subscription("OnRepoCreation"))
export class OnRepoCreation implements HandleEvent<schema.OnRepoCreation.Subscription> {

    @Value("")
    public configuration: Configuration;

    private readonly newRepoActions: RepoCreationListener[];

    constructor(newRepoActions: RepoCreationListener[],
                private readonly repoRefResolver: RepoRefResolver,
                private readonly credentialsFactory: CredentialsResolver,
                private readonly preferenceStoreFactory: PreferenceStoreFactory) {
        this.newRepoActions = newRepoActions;
    }

    public async handle(event: EventFired<schema.OnRepoCreation.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const repo = event.data.Repo[0];
        const id = this.repoRefResolver.toRemoteRepoRef(repo, {});
        const credentials = await resolveCredentialsPromise(this.credentialsFactory.eventHandlerCredentials(context, id));
        const preferences = this.preferenceStoreFactory(context);

        const invocation: RepoCreationListenerInvocation = {
            addressChannels: AddressNoChannels,
            preferences,
            configuration: this.configuration,
            id,
            context,
            repo,
            credentials,
        };
        await Promise.all(this.newRepoActions.map(a => a(invocation)));
        return Success;
    }
}
