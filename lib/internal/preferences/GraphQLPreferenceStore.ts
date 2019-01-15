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
    addressEvent,
    HandlerContext,
    QueryNoCacheOptions,
} from "@atomist/automation-client";
import {
    PreferenceStoreFactory,
} from "@atomist/sdm";
import * as _ from "lodash";
import { SdmPreferenceByKey } from "../../typings/types";
import {
    AbstractPreferenceStore,
    Preference,
} from "./AbstractPreferenceStore";

/**
 * Factory to create a new GraphQLPreferenceStore instance
 * @param ctx
 * @constructor
 */
export const GraphQLPreferenceStoreFactory: PreferenceStoreFactory = ctx => new GraphQLPreferenceStore(ctx);

/**
 * PreferenceStore implementation that stores preferences in the backend GraphQL store.
 */
export class GraphQLPreferenceStore extends AbstractPreferenceStore {

    constructor(private readonly context: HandlerContext) {
        super(context);
    }

    protected async doGet(key: string): Promise<Preference | undefined> {
        const result = await this.context.graphClient.query<SdmPreferenceByKey.Query, SdmPreferenceByKey.Variables>({
            name: "SdmPreferenceByKey",
            variables: {
                key: [key],
            },
            options: QueryNoCacheOptions,
        });
        return _.get(result, "SdmPreference[0]") as Preference;
    }

    protected doPut(pref: Preference): Promise<void> {
        return this.context.messageClient.send(pref, addressEvent("SdmPreference"));
    }

}
