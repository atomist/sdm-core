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
    Success,
} from "@atomist/automation-client";
import { EventHandler } from "@atomist/automation-client/lib/decorators";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    addressChannelsFor,
    CredentialsResolver,
    PreferenceStoreFactory,
    ProjectLoader,
    PullRequestListener,
    PullRequestListenerInvocation,
    RepoRefResolver,
} from "@atomist/sdm";
import * as schema from "../../../typings/types";

/**
 * A pull request has been raised
 */
@EventHandler("On pull request", GraphQL.subscription("OnPullRequest"))
export class OnPullRequest implements HandleEvent<schema.OnPullRequest.Subscription> {

    constructor(
        private readonly projectLoader: ProjectLoader,
        private readonly repoRefResolver: RepoRefResolver,
        private readonly listeners: PullRequestListener[],
        private readonly credentialsFactory: CredentialsResolver,
        private readonly preferenceStoreFactory: PreferenceStoreFactory) {
    }

    public async handle(event: EventFired<schema.OnPullRequest.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const pullRequest = event.data.PullRequest[0];
        const repo = pullRequest.repo;
        const id = this.repoRefResolver.toRemoteRepoRef(
            repo,
            {
                sha: pullRequest.head.sha,
                branch: pullRequest.branch.name,
            });
        const credentials = this.credentialsFactory.eventHandlerCredentials(context, id);
        const addressChannels = addressChannelsFor(repo, context);
        const preferences = this.preferenceStoreFactory(context);

        await this.projectLoader.doWithProject({ credentials, id, context, readOnly: true }, async project => {
            const prli: PullRequestListenerInvocation = {
                id,
                context,
                addressChannels,
                preferences,
                credentials,
                project,
                pullRequest,
            };
            await Promise.all(this.listeners
                .map(l => l(prli)),
            );
        });
        return Success;
    }
}
