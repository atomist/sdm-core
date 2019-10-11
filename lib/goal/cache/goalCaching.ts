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
    DefaultExcludes,
    GitProject,
    Project,
    projectUtils,
} from "@atomist/automation-client";
import {
    AnyPush,
    ExecuteGoalResult,
    GoalInvocation,
    GoalProjectListenerEvent,
    GoalProjectListenerRegistration,
    PushTest,
} from "@atomist/sdm";
import * as _ from "lodash";
import { toArray } from "../../util/misc/array";
import { CompressingGoalCache } from "./CompressingGoalCache";

/**
 * Goal cache interface for storing and retrieving arbitrary files produced
 * by the execution of a goal.
 * @see FileSystemGoalCache`
 */
export interface GoalCache {

    /**
     * Add a set of files (or directories) to the cache.
     * @param gi The goal invocation for which the cache needs to be stored.
     * @param p The project where the files (or directories) reside.
     * @param files The files (or directories) to be cached.
     * @param classifier An optional classifier to identify the set of files (or directories to be cached).
     */
    put(gi: GoalInvocation, p: GitProject, files: string | string[], classifier?: string): Promise<void>;

    /**
     * Retrieve files from the cache.
     * @param gi The goal invocation for which the cache needs to be restored.
     * @param p he project where the files (or directories) need to be restored in.
     * @param classifier Optionally the classifier of the cache for the files to be restored. If not defined,
     *                   all caches for the GoalInvocation are restored.
     */
    retrieve(gi: GoalInvocation, p: GitProject, classifier?: string): Promise<void>;

    /**
     * Remove files from the cache.
     * @param gi The goal invocation for which the cache needs to be removed.
     * @param classifier Optionally the classifier of the cache for the files to be removed. If not defined,
     *                   all classifiers are removed.
     */
    remove(gi: GoalInvocation, classifier?: string): Promise<void>;
}

/**
 * Suitable for a limited set of files adhering to a pattern.
 */
export interface GlobFilePattern {
    globPattern: string | string[];
}

/**
 * Suitable for caching complete directories, possibly containing a lot of files.
 */
export interface DirectoryPattern {
    directory: string;
}

export interface CacheEntry {
    classifier: string;
    pattern: GlobFilePattern | DirectoryPattern;
}

/**
 * Core options for goal caching.
 */
export interface GoalCacheCoreOptions {
    /**
     * Optional push test on when to trigger caching
     */
    pushTest?: PushTest;
    /**
     * Optional listener functions that should be called when no cache entry is found.
     */
    onCacheMiss?: GoalProjectListenerRegistration | GoalProjectListenerRegistration[];
}

/**
 * Options for putting goal cache entries.
 */
export interface GoalCacheOptions extends GoalCacheCoreOptions {
    /**
     * Collection of glob patterns with classifiers to determine which
     * files need to be cached between goal invocations, possibly
     * excluding paths using regular expressions.
     */
    entries: CacheEntry[];
}

/**
 * Options for restoring goal cache entries.
 */
export interface GoalCacheRestoreOptions extends GoalCacheCoreOptions {
    entries?: Array<{ classifier: string }>;
}

const DefaultGoalCache = new CompressingGoalCache();

/**
 * Goal listener that performs caching after a goal has been run.
 * @param options The options for caching
 * @param classifier Whether only a specific classifier, as defined in the options,
 * needs to be cached. If omitted, all classifiers are cached.
 * @param classifiers Additional classifiers that need to be created.
 */
export function cachePut(options: GoalCacheOptions,
                         classifier?: string,
                         ...classifiers: string[]): GoalProjectListenerRegistration {
    const allClassifiers = [];
    if (classifier) {
        allClassifiers.push(classifier, ...(classifiers || []));
    }

    const entries = !!classifier ?
        options.entries.filter(pattern => allClassifiers.includes(pattern.classifier)) :
        options.entries;

    const listenerName = `caching ${entries.map(e => e.classifier).join(", ")}`;

    return {
        name: listenerName,
        listener: async (p: GitProject,
                         gi: GoalInvocation): Promise<void | ExecuteGoalResult> => {
            if (!!isCacheEnabled(gi)) {
                const goalCache = cacheStore(gi);
                for (const entry of entries) {
                    const files = [];
                    if (isGlobFilePattern(entry.pattern)) {
                        files.push(...(await getFilePathsThroughPattern(p, entry.pattern.globPattern)));
                    } else if (isDirectoryPattern(entry.pattern)) {
                        files.push(entry.pattern.directory);
                    }
                    if (!_.isEmpty(files)) {
                        await goalCache.put(gi, p, files, entry.classifier);
                    }
                }
            }
        },
        pushTest: options.pushTest,
        events: [GoalProjectListenerEvent.after],
    };
}

function isGlobFilePattern(toBeDetermined: any): toBeDetermined is GlobFilePattern { return toBeDetermined.globPattern !== undefined; }
function isDirectoryPattern(toBeDetermined: any): toBeDetermined is DirectoryPattern { return toBeDetermined.directory !== undefined; }

async function pushTestSucceeds(pushTest: PushTest, gi: GoalInvocation, p: GitProject): Promise<boolean> {
    return (pushTest || AnyPush).mapping({
        push: gi.goalEvent.push,
        project: p,
        id: gi.id,
        configuration: gi.configuration,
        addressChannels: gi.addressChannels,
        context: gi.context,
        preferences: gi.preferences,
        credentials: gi.credentials,
    });
}

async function invokeCacheMissListeners(optsToUse: GoalCacheOptions | GoalCacheRestoreOptions,
                                        p: GitProject,
                                        gi: GoalInvocation,
                                        event: GoalProjectListenerEvent): Promise<void> {
    for (const cacheMissFallback of toArray(optsToUse.onCacheMiss)) {
        const allEvents = [GoalProjectListenerEvent.before, GoalProjectListenerEvent.after];
        if ((cacheMissFallback.events || allEvents).filter(e => e === event).length > 0
            && await pushTestSucceeds(cacheMissFallback.pushTest, gi, p)) {
            await cacheMissFallback.listener(p, gi, event);
        }
    }
}

export const NoOpGoalProjectListenerRegistration: GoalProjectListenerRegistration = {
    name: "NoOpListener",
    listener: async () => { },
    pushTest: AnyPush,
};

/**
 * Goal listener that performs cache restores before a goal has been run.
 * @param options The options for caching
 * @param classifier Whether only a specific classifier, as defined in the options,
 * needs to be restored. If omitted, all classifiers defined in the options are restored.
 * @param classifiers Additional classifiers that need to be restored.
 */
export function cacheRestore(options: GoalCacheRestoreOptions,
                             classifier?: string,
                             ...classifiers: string[]): GoalProjectListenerRegistration {
    const allClassifiers = [];
    if (classifier) {
        allClassifiers.push(classifier, ...(classifiers || []));
    }

    const optsToUse: GoalCacheRestoreOptions = {
        onCacheMiss: NoOpGoalProjectListenerRegistration,
        ...options,
    };

    const classifiersToBeRestored = [];
    if (allClassifiers.length > 0) {
        classifiersToBeRestored.push(...allClassifiers);
    } else {
        classifiersToBeRestored.push(...optsToUse.entries.map(entry => entry.classifier));
    }

    const listenerName = `restoring ${classifiersToBeRestored.join(", ")}`;

    return {
        name: listenerName,
        listener: async (p: GitProject,
                         gi: GoalInvocation,
                         event: GoalProjectListenerEvent): Promise<void | ExecuteGoalResult> => {
            if (!!isCacheEnabled(gi)) {
                const goalCache = cacheStore(gi);
                for (const c of classifiersToBeRestored) {
                    try {
                        await goalCache.retrieve(gi, p, c);
                    } catch (e) {
                        await invokeCacheMissListeners(optsToUse, p, gi, event);
                    }
                }
            } else {
                await invokeCacheMissListeners(optsToUse, p, gi, event);
            }
        },
        pushTest: optsToUse.pushTest,
        events: [GoalProjectListenerEvent.before],
    };
}

/**
 * Goal listener that cleans up the cache restores after a goal has been run.
 * @param options The options for caching
 * @param classifier Whether only a specific classifier, as defined in the options,
 * needs to be removed. If omitted, all classifiers are removed.
 * @param classifiers Additional classifiers that need to be removed.
 */
export function cacheRemove(options: GoalCacheOptions,
                            classifier?: string,
                            ...classifiers: string[]): GoalProjectListenerRegistration {
    const allClassifiers = [];
    if (classifier) {
        allClassifiers.push(...[classifier, ...classifiers]);
    }

    const classifiersToBeRemoved = [];
    if (allClassifiers.length > 0) {
        classifiersToBeRemoved.push(...allClassifiers);
    } else {
        classifiersToBeRemoved.push(...options.entries.map(entry => entry.classifier));
    }

    const listenerName = `removing ${classifiersToBeRemoved.join(", ")}`;

    return {
        name: listenerName,
        listener: async (p, gi) => {
            if (!!isCacheEnabled(gi)) {
                const goalCache = cacheStore(gi);

                for (const c of classifiersToBeRemoved) {
                    await goalCache.remove(gi, c);
                }
            }
        },
        pushTest: options.pushTest,
        events: [GoalProjectListenerEvent.after],
    };
}

async function getFilePathsThroughPattern(project: Project, globPattern: string | string[]): Promise<string[]> {
    const oldExcludes = DefaultExcludes;
    DefaultExcludes.splice(0, DefaultExcludes.length);  // necessary evil
    try {
        return await projectUtils.gatherFromFiles(project, globPattern, async f => f.path);
    } finally {
        DefaultExcludes.push(...oldExcludes);
    }
}

function isCacheEnabled(gi: GoalInvocation): boolean {
    return _.get(gi.configuration, "sdm.cache.enabled", false);
}

function cacheStore(gi: GoalInvocation): GoalCache {
    return _.get(gi.configuration, "sdm.cache.store", DefaultGoalCache);
}
