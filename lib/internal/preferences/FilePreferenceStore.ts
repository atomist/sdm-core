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

import { HandlerContext } from "@atomist/automation-client";
import { PreferenceStoreFactory } from "@atomist/sdm";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
    lock,
    unlock,
} from "proper-lockfile";
import {
    AbstractPreferenceStore,
    Preference,
} from "./AbstractPreferenceStore";

interface PreferenceFile {
    [key: string]: { value: string, ttl?: number };
}

/**
 * Factory to create a new FilePreferenceStore instance
 * @param ctx
 * @constructor
 */
export const FilePreferenceStoreFactory: PreferenceStoreFactory = ctx => new FilePreferenceStore(ctx);

/**
 * PreferenceStore implementation that stores preferences in a shared file.
 * Note: this implementation attempts to lock the preference file before reading or writing to it
 * but it is not intended for production usage.
 */
export class FilePreferenceStore extends AbstractPreferenceStore {

    constructor(private readonly context: HandlerContext,
                private readonly fileName: string = "client.prefs.json") {
        super(context);
    }

    public path(): string {
        const p = path.join(os.userInfo().homedir, ".atomist", "prefs");
        if (!fs.pathExistsSync(p)) {
            fs.mkdirsSync(p);
        }
        const f = path.join(p, this.fileName);
        if (!fs.existsSync(f)) {
            fs.writeJSONSync(f, {});
        }
        return f;
    }

    protected async doGet(key: string): Promise<Preference | undefined> {
        const p = this.path();
        await lock(p, { retries: 5 });
        const prefs = await this.read();
        await unlock(p);
        if (!!prefs[key]) {
            return {
                key,
                value: prefs[key].value,
                ttl: prefs[key].ttl,
            };
        } else {
            return undefined;
        }
    }

    protected async doPut(pref: Preference): Promise<void> {
        const p = this.path();
        await lock(p, { retries: 5 });
        const prefs = await this.read();
        prefs[pref.key] = { value: pref.value, ttl: pref.ttl };
        await fs.writeJSON(p, prefs);
        await unlock(p);
        return;
    }

    private async read(): Promise<PreferenceFile> {
        const p = this.path();
        if (fs.existsSync(p)) {
            return (await fs.readJSON(p)) as PreferenceFile;
        } else {
            return {};
        }
    }
}
