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

import { formatDate } from "@atomist/sdm";
import * as fs from "fs-extra";
import { FilePreferenceStore } from "../../../lib/internal/preferences/FilePreferenceStore";
import { assertPreferences } from "./preferences";

describe("FilePreferenceStore", () => {

    it("should correctly handle preferences", async () => {
        const prefs = new FilePreferenceStore({ configuration: { name: "my-sdm" } } as any, `client.prefs-${formatDate()}.json`);
        await assertPreferences(prefs, false);
        await fs.unlink(prefs.path());
    });

    it("should correctly handle scoped preferences", async () => {
        const prefs = new FilePreferenceStore({ configuration: { name: "my-sdm" } } as any, `client.prefs-${formatDate()}.json`);
        await assertPreferences(prefs, true);
        await fs.unlink(prefs.path());
    });

});
