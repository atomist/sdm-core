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
    configurationValue,
    DefaultHttpClientFactory,
    HttpClientFactory,
    HttpMethod,
    HttpResponse,
    logger,
} from "@atomist/automation-client";
import {
    EndpointVerificationInvocation,
    EndpointVerificationListener,
} from "@atomist/sdm";
import * as https from "https";
import { WrapOptions } from "retry";

/**
 * Make an HTTP request to the reported endpoint to check
 */
export function lookFor200OnEndpointRootGet(retryOpts: Partial<WrapOptions> = {}): EndpointVerificationListener {
    return async (inv: EndpointVerificationInvocation) => {
        const httpClient = configurationValue<HttpClientFactory>("http.client.factory", DefaultHttpClientFactory).create();
        const agent = new https.Agent({
            rejectUnauthorized: false,
        });
        if (!inv.url) {
            throw new Error("Verify called with null URL");
        }
        try {
            const resp = await httpClient.exchange(inv.url, {
                method: HttpMethod.Get,
                options: { httpsAgent: agent },
                retry: retryOpts,
            });
            logger.debug(`lookFor200OnEndpointRootGet: Response for ${inv.url} was ${resp.status}`);
            if (resp.status !== 200) {
                throw new Error(`Unexpected response when getting ${inv.url}: ${resp.status}`);
            }
            return;
        } catch (e) {
            logger.warn(`Unexpected error when getting ${inv.url}: ${e.message}`);
            // Let a failure go through
        }
    };
}
