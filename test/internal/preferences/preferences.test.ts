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
