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
    AutomationContextAware,
    configurationValue,
    HandlerContext,
    Parameters,
    ProjectOperationCredentials,
    RemoteRepoRef,
    Secret,
    Secrets,
    Value,
} from "@atomist/automation-client";
import { ProviderType as RepoProviderType } from "@atomist/automation-client/lib/operations/common/RepoId";
import { CredentialsResolver } from "@atomist/sdm";
import * as _ from "lodash";
import {
    ProviderType,
    ScmProviderByType,
} from "../../typings/types";

@Parameters()
export class GitHubCredentialsResolver implements CredentialsResolver {

    @Secret(Secrets.OrgToken)
    private readonly orgToken: string;

    @Value({ path: "token", required: false, type: "string" })
    private readonly clientToken: string;

    public async eventHandlerCredentials(context: HandlerContext,
                                         id?: RemoteRepoRef): Promise<ProjectOperationCredentials> {
        return this.credentials(context, id);
    }

    public async commandHandlerCredentials(context: HandlerContext,
                                           id?: RemoteRepoRef): Promise<ProjectOperationCredentials> {
        return this.credentials(context, id);
    }

    private async credentials(context: HandlerContext,
                              id?: RemoteRepoRef): Promise<ProjectOperationCredentials> {

        // First try to obtain the token from the incoming event or command request
        const actx: AutomationContextAware = context as any;
        if (actx.trigger && actx.trigger.secrets) {
            const secret = actx.trigger.secrets.find(s => s.uri === Secrets.OrgToken);
            if (secret && hasToken(secret.value)) {
                return { token: secret.value };
            }
        }

        if (hasToken(this.orgToken)) {
            return { token: this.orgToken };
        } else if (hasToken(this.clientToken)) {
            return { token: this.clientToken };
        } else if (hasToken(configurationValue("token", "null"))) {
            return { token: configurationValue<string>("token")};
        } else if (hasToken(configurationValue("sdm.github.token", "null"))) {
            return { token: configurationValue<string>("sdm.github.token")};
        }

        // Check the graph to see if we have a token on the provider
        if (!!id && (id.providerType === RepoProviderType.github_com)) {
            const token = await fetchTokenByProviderType(ProviderType.ghe, context);
            if (hasToken(token)) {
                return { token };
            }
        }

        throw new Error("Neither 'orgToken' nor 'clientToken' has been injected. " +
            "Please add a repo-scoped GitHub token to your configuration at 'token' or 'sdm.github.token'.");
    }
}

function hasToken(token: string): boolean {
    if (!token) {
        return false;
        // "null" as string is being sent when the orgToken can't be determined by the api
    } else if (token === "null" || token === "undefined") {
        return false;
    }
    return true;
}

async function fetchTokenByProviderType(providerType: ProviderType,
                                        ctx: HandlerContext): Promise<string> {
    const provider = await ctx.graphClient.query<ScmProviderByType.Query, ScmProviderByType.Variables>({
        name: "ScmProviderByType",
        variables: {
            providerType,
        },
    });

    return _.get(provider, "SCMProvider[0].credential.secret");
}
