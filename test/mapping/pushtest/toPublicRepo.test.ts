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

import { GitHubRepoRef } from "@atomist/automation-client/lib/operations/common/GitHubRepoRef";
import { PushListenerInvocation } from "@atomist/sdm/lib/api/listener/PushListener";
import * as assert from "power-assert";
import { ToPublicRepo } from "../../../lib/mapping/pushtest/toPublicRepo";

describe("pushToPublicRepo", () => {

    let credentials: any;
    before(function(): void {
        if (process.env.GITHUB_TOKEN) {
            credentials = { token: process.env.GITHUB_TOKEN };
        } else {
            // tslint:disable-next-line:no-invalid-this
            this.skip();
        }
    });

    it("should work against public repo", async () => {
        const id = new GitHubRepoRef("atomist", "sdm");
        const r = await ToPublicRepo.mapping({ id, credentials } as any as PushListenerInvocation);
        assert.equal(r, true);
    }).timeout(8000);

    it("should work against private repo", async () => {
        const id = new GitHubRepoRef("atomisthq", "internal-automation");
        const r = await ToPublicRepo.mapping({ id, credentials } as any as PushListenerInvocation);
        assert.equal(r, false);
    }).timeout(8000);

});
