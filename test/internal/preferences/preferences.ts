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

import { PreferenceStore } from "@atomist/sdm";
import * as assert from "power-assert";

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function assertPreferences(prefs: PreferenceStore, scoped: boolean) {
    assert(!(await prefs.get("foo", { scoped })));
    await prefs.put("foo", "bar", { scoped });
    assert.strictEqual(await prefs.get("foo", { scoped }), "bar");

    await prefs.put("foo", "barbar", { scoped });
    assert.strictEqual(await prefs.get("foo", { scoped }), "barbar");

    await prefs.put("bar", "foo", { scoped, ttl: 10 });
    await sleep(20);
    assert(!(await prefs.get("bar", { scoped })));

    const b = { foo: "bar" };
    await prefs.put("bar", b, { scoped });
    assert.deepStrictEqual((await prefs.get("bar", { scoped })), b);
    assert(!(await prefs.get("bar", { scoped: !scoped })));
}
