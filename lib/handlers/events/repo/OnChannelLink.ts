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
    AddressChannels,
    addressChannelsFor,
    ChannelLinkListener,
    ChannelLinkListenerInvocation,
    CredentialsResolver,
    PreferenceStoreFactory,
    ProjectLoader,
    RepoRefResolver,
    resolveCredentialsPromise,
} from "@atomist/sdm";
import * as schema from "../../../typings/types";

/**
 * A new channel has been linked to a repo
 */
@EventHandler("On channel link", GraphQL.subscription("OnChannelLink"))
export class OnChannelLink implements HandleEvent<schema.OnChannelLink.Subscription> {

    @Value("")
    public configuration: Configuration;

    constructor(
        private readonly projectLoader: ProjectLoader,
        private readonly repoRefResolver: RepoRefResolver,
        private readonly listeners: ChannelLinkListener[],
        private readonly credentialsFactory: CredentialsResolver,
        private readonly preferenceStoreFactory: PreferenceStoreFactory) {
    }

    public async handle(event: EventFired<schema.OnChannelLink.Subscription>,
                        context: HandlerContext): Promise<HandlerResult> {
        const repo = event.data.ChannelLink[0].repo;
        const id = this.repoRefResolver.toRemoteRepoRef(
            repo,
            {
                branch: repo.defaultBranch,
            });
        const credentials = await resolveCredentialsPromise(this.credentialsFactory.eventHandlerCredentials(context, id));

        const addressChannels: AddressChannels = addressChannelsFor(repo, context);
        const preferences = this.preferenceStoreFactory(context);

        const newlyLinkedChannelName = event.data.ChannelLink[0].channel.name;
        await this.projectLoader.doWithProject({ credentials, id, context, readOnly: true }, async project => {
            const invocation: ChannelLinkListenerInvocation = {
                id,
                context,
                addressChannels,
                preferences,
                configuration: this.configuration,
                credentials,
                project,
                newlyLinkedChannelName,
                addressNewlyLinkedChannel: (msg, opts) => context.messageClient.addressChannels(msg, newlyLinkedChannelName, opts),
            };
            await Promise.all(this.listeners
                .map(l => l(invocation)),
            );
        });
        return Success;
    }
}
