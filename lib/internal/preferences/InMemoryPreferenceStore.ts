import { HandlerContext } from "@atomist/automation-client";
import { PreferenceStoreFactory } from "@atomist/sdm";
import {
    AbstractPreferenceStore,
    Preference,
} from "./AbstractPreferenceStore";

/**
 * Factory to create a new InMemoryPreferenceStore instance
 * @param ctx
 * @constructor
 */
export const InMemoryPreferenceStoreFactory: PreferenceStoreFactory = ctx => new InMemoryPreferenceStore(ctx);

/**
 * PreferenceStore implementation that simply stores preferences in-memory.
 * Note: This is implementation is not intended for production usage.
 */
export class InMemoryPreferenceStore extends AbstractPreferenceStore {

    private readonly store: { [key: string]: Preference } = {};

    constructor(private readonly context: HandlerContext) {
        super(context);
    }

    protected async doGet(key: string): Promise<Preference | undefined> {
        return this.store[key];
    }

    protected doPut(pref: Preference): Promise<void> {
        this.store[pref.key] = pref;
        return;
    }
}
