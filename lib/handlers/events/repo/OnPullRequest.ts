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

import { Configuration } from "@atomist/automation-client/lib/configuration";
import {
    EventHandler,
    Value,
} from "@atomist/automation-client/lib/decorators";
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
import { resolveCredentialsPromise } from "@atomist/sdm/lib/api-helper/machine/handlerRegistrations";
import { addressChannelsFor } from "@atomist/sdm/lib/api/context/addressChannels";
import { PreferenceStoreFactory } from "@atomist/sdm/lib/api/context/preferenceStore";
import { createSkillContext } from "@atomist/sdm/lib/api/context/skillConfiguration";
import {
    PullRequestListener,
    PullRequestListenerInvocation,
} from "@atomist/sdm/lib/api/listener/PullRequestListener";
import { CredentialsResolver } from "@atomist/sdm/lib/spi/credentials/CredentialsResolver";
import { ProjectLoader } from "@atomist/sdm/lib/spi/project/ProjectLoader";
import { RepoRefResolver } from "@atomist/sdm/lib/spi/repo-ref/RepoRefResolver";
import * as _ from "lodash";
import * as schema from "../../../typings/types";

/**
 * A pull request has been raised
 */
@EventHandler("On pull request", subscription("OnPullRequest"))
export class OnPullRequest implements HandleEvent<schema.OnPullRequest.Subscription> {

    @Value("")
    public configuration: Configuration;

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

        const branch = _.get(pullRequest, "branch.name") || _.get(pullRequest, "head.pushes[0].branch");
        const id = this.repoRefResolver.toRemoteRepoRef(
            repo,
            {
                sha: pullRequest.head.sha,
                branch,
            });
        const credentials = await resolveCredentialsPromise(this.credentialsFactory.eventHandlerCredentials(context, id));
        const addressChannels = addressChannelsFor(repo, context);
        const preferences = this.preferenceStoreFactory(context);

        await this.projectLoader.doWithProject({ credentials, id, context, readOnly: true }, async project => {
            const prli: PullRequestListenerInvocation = {
                id,
                context,
                addressChannels,
                preferences,
                configuration: this.configuration,
                credentials,
                project,
                pullRequest,
                skill: createSkillContext(context),
            };
            await Promise.all(this.listeners
                .map(l => l(prli)),
            );
        });
        return Success;
    }
}
