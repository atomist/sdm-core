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
    Secret,
    Secrets,
    Value,
} from "@atomist/automation-client";
import { CredentialsResolver } from "@atomist/sdm";

@Parameters()
export class GitHubCredentialsResolver implements CredentialsResolver {

    @Secret(Secrets.OrgToken)
    private readonly orgToken: string;

    @Value({ path: "token", required: false, type: "string" })
    private readonly clientToken: string;

    public eventHandlerCredentials(context: HandlerContext): ProjectOperationCredentials {
        return this.credentials(context);
    }

    public commandHandlerCredentials(context: HandlerContext): ProjectOperationCredentials {
        return this.credentials(context);
    }

    private credentials(context: HandlerContext): ProjectOperationCredentials {

        // First try to obtain the token from the incoming event or command request
        const actx: AutomationContextAware = context as any;
        if (actx.trigger && actx.trigger.secrets) {
            const secret = actx.trigger.secrets.find(s => s.uri === Secrets.OrgToken);
            if (secret && this.hasToken(secret.value)) {
                return { token: secret.value };
            }
        }

        if (this.hasToken(this.orgToken)) {
            return { token: this.orgToken };
        } else if (this.hasToken(this.clientToken)) {
            return { token: this.clientToken };
        } else if (this.hasToken(configurationValue("token"))) {
            return { token: configurationValue<string>("token")};
        } else if (this.hasToken(configurationValue("sdm.github.token"))) {
            return { token: configurationValue<string>("sdm.github.token")};
        }
        throw new Error("Neither 'orgToken' nor 'clientToken' has been injected. " +
            "Please add a repo-scoped GitHub token to your configuration at 'token' or 'sdm.github.token'.");
    }

    private hasToken(token: string): boolean {
        if (!token) {
            return false;
            // "null" as string is being sent when the orgToken can't be determined by the api
        } else if (token === "null" || token === "undefined") {
            return false;
        }
        return true;
    }

}
