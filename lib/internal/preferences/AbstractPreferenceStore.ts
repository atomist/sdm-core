import {
    ConfigurationAware,
    HandlerContext,
} from "@atomist/automation-client";
import { PreferenceStore } from "@atomist/sdm";

export interface Preference {
    key: string;
    value: string;
    ttl: number;
}

/**
 * Abstract PreferenceStore implementation to handle ttl and key scoping
 */
export abstract class AbstractPreferenceStore implements PreferenceStore {

    protected constructor(private readonly ctx: HandlerContext) {
    }

    public async get<V>(key: string, options?: { scoped?: boolean }): Promise<V | undefined> {
        const pref = await this.doGet(this.scopeKey(key, options));
        if (!pref) {
            return undefined;
        }
        if (!!pref.ttl && pref.ttl < Date.now()) {
            return undefined;
        } else {
            return JSON.parse(pref.value) as V;
        }
    }

    public async put<V>(key: string, value: V, options: { ttl?: number; scoped?: boolean } = {}): Promise<V> {
        const pref: Preference = {
            key: this.scopeKey(key, options),
            value: JSON.stringify(value),
            ttl: typeof options.ttl === "number" ? Date.now() + options.ttl : undefined,
        };
        await this.doPut(pref);
        return value;
    }

    protected abstract doGet(key: string): Promise<Preference | undefined>;

    protected abstract doPut(pref: Preference): Promise<void>;

    private scopeKey(key: string, options?: { scoped?: boolean }): string {
        let k = key;
        if (options && options.scoped) {
            k = `${(this.ctx as any as ConfigurationAware).configuration.name}.${key}`;
        }
        return k;
    }
}
