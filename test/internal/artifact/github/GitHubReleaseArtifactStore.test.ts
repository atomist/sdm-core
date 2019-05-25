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

// tslint:disable:deprecation

import { GitHubRepoRef } from "@atomist/automation-client";
import { execPromise } from "@atomist/sdm";
import * as fs from "fs";
import * as p from "path";
import * as assert from "power-assert";
import { GitHubReleaseArtifactStore } from "../../../../lib/internal/artifact/github/GitHubReleaseArtifactStore";

const asset = "https://github.com/spring-team/fintan/releases/download/0.1.0-SNAPSHOT454/fintan-0.1.0-SNAPSHOT.jar";

describe("GitHubReleaseArtifactStore", () => {

    describe("checkout", () => {

        it("should checkout existing file", async () => {
            const ghras = new GitHubReleaseArtifactStore();
            const id = new GitHubRepoRef("spring-team", "fintan");
            try {
                const da = await ghras.checkout(asset, id, {});
                const path = `${da.cwd}/${da.filename}`;
                assert(fs.existsSync(path), `File '${path}' should exist`);
                const cwd = p.dirname(path);
                const filename = p.basename(path);
                await execPromise("unzip", [filename], { cwd });
            } catch (e) {
                assert.fail(e.message);
            }
        }).timeout(10000);

        it("should checkout existing file and parse AppInfo", async () => {
            const ghras = new GitHubReleaseArtifactStore();
            const id = new GitHubRepoRef("spring-team", "fintan");
            try {
                const da = await ghras.checkout(asset, id, {});
                assert.equal(da.id.owner, id.owner);
                assert.equal(da.id.repo, id.repo);
                assert.equal(da.name, "fintan", "name should be 'fintan', not " + da.name);
                assert.equal(da.version, "0.1.0-SNAPSHOT", "version should be '0.1.0-SNAPSHOT', not " + da.version);
            } catch (e) {
                assert.fail(e.message);
            }
        }).timeout(10000);
    });

});