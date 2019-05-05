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
    HandlerContext,
    MutationNoCacheOptions,
    QueryNoCacheOptions,
} from "@atomist/automation-client";
import { PreferenceStoreFactory } from "@atomist/sdm";
import {
    SetTeamConfiguration,
    TeamConfigurationByNamespace,
} from "../../typings/types";
import {
    AbstractPreferenceStore,
    Preference,
} from "./AbstractPreferenceStore";

/**
 * Factory to create a new TeamConfigurationPreferenceStore instance
 */
export const TeamConfigurationPreferenceStoreFactory: PreferenceStoreFactory =
    ctx => new TeamConfigurationPreferenceStore(ctx);

/**
 * PreferenceStore implementation that stores preferences in the backend GraphQL store.
 */
export class TeamConfigurationPreferenceStore extends AbstractPreferenceStore {

    constructor(private readonly context: HandlerContext) {
        super(context);
    }

    protected async doGet(name: string, namespace: string): Promise<Preference | undefined> {
        const result = await this.context.graphClient.query<TeamConfigurationByNamespace.Query, TeamConfigurationByNamespace.Variables>({
            name: "TeamConfigurationByNamespace",
            variables: {
                namespace: namespace,
            },
            options: QueryNoCacheOptions,
        });
        const teamConfiguration = (result.TeamConfiguration || []).find(t => t.name === name);
        if (!!teamConfiguration) {
            return {
                name,
                namespace,
                value: teamConfiguration.value,
                ttl: undefined, // ttl is handled in the backend store
            };
        }
        return undefined;
    }

    protected async doPut(pref: Preference): Promise<void> {
        await this.context.graphClient.mutate<SetTeamConfiguration.Mutation, SetTeamConfiguration.Variables>({
            name: "SetTeamConfiguration",
            variables: {
                name: pref.name,
                namespace: pref.namespace,
                value: pref.value,
                ttl: typeof pref.ttl === "number" ? Math.floor(pref.ttl / 1000) : undefined,
            },
            options: MutationNoCacheOptions,
        });
    }
}
