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
    GitProject,
    Project,
    projectUtils,
    RepoRef,
} from "@atomist/automation-client";
import {
    ExecuteGoalResult,
    GoalInvocation,
    GoalProjectListener,
    GoalProjectListenerEvent,
    GoalProjectListenerRegistration,
    ProgressLog,
    PushTest,
} from "@atomist/sdm";
import * as _ from "lodash";

/**
 * Goal cache interface for storing and retrieving arbitrary files produced by the execution of a goal.
 * @see FileSystemGoalCache`
 */
export interface GoalCache {
    put(id: RepoRef, project: Project, file: string[], classifier: string, log: ProgressLog): Promise<void>;
    retrieve(id: RepoRef, project: Project, log: ProgressLog, classifier?: string): Promise<void>;
    remove(id: RepoRef, classifier?: string): Promise<void>;
}

/**
 * Options for goal caching
 */
export interface GoalCacheOptions {
    /**
     * Push test on when to trigger caching
     */
    pushTest?: PushTest;
    /**
     * Required. Collection of glob patterns with classifiers to determine which files need to be cached between
     * goal invocations.
     */
    globPatterns: Array<{classifier: string, pattern: string}>;
    /**
     * Required. Listener function that should be called when no cache entry is found.
     */
    fallbackListenerOnCacheMiss: GoalProjectListener;
}

/**
 * Goal listener that performs caching after a goal has been run.
 * @param options The options for caching
 * @param classifier Whether only a specific classifier, as defined in the options, needs to be cached. If omitted,
 *                   all classifiers are cached.
 */
export function cacheGoalArtifacts(options: GoalCacheOptions,
                                   classifier?: string): GoalProjectListenerRegistration {
    return {
        name: "cache-artifacts",
        listener: archiveAndCacheArtifacts,
        pushTest: options.pushTest,
        events: [GoalProjectListenerEvent.after],
    };

    async function archiveAndCacheArtifacts(p: GitProject,
                                            gi: GoalInvocation): Promise<void | ExecuteGoalResult> {
        const cacheEnabled = gi.configuration.sdm.cache.enabled as boolean;
        if (cacheEnabled) {
            const goalCache = gi.configuration.sdm.goalCache as GoalCache;
            const patterns = classifier ? options.globPatterns.filter(pattern => pattern.classifier === classifier) : options.globPatterns;
            await Promise.all(patterns.map(async globPattern => {
                const files = await getFilePathsThroughPattern(p, globPattern.pattern);
                if (!_.isEmpty(files)) {
                    await goalCache.put(gi.id, p, files, globPattern.classifier, gi.progressLog);
                }
            }));
        }
    }
}

function getFilePathsThroughPattern(project: Project, globPattern: string): Promise<string[]> {
    return projectUtils.gatherFromFiles(project, globPattern, async f => f.path);
}

/**
 * Goal listener that performs cache restores before a goal has been run.
 * @param options The options for caching
 * @param classifier Whether only a specific classifier, as defined in the options, needs to be restored. If omitted,
 *                   all classifiers are restored.
 */
export function restoreGoalArtifacts(options: GoalCacheOptions,
                                     classifier?: string): GoalProjectListenerRegistration {
    return {
        name: "restore-artifacts",
        listener: retrieveAndRestoreArtifacts,
        pushTest: options.pushTest,
        events: [GoalProjectListenerEvent.before],
    };

    async function retrieveAndRestoreArtifacts(p: GitProject,
                                               gi: GoalInvocation,
                                               event: GoalProjectListenerEvent): Promise<void | ExecuteGoalResult> {
        const cacheEnabled = gi.configuration.sdm.cache.enabled as boolean;
        if (cacheEnabled) {
            const goalCache = gi.configuration.sdm.goalCache as GoalCache;
            try {
                await goalCache.retrieve(gi.id, p, gi.progressLog, classifier);
            } catch (e) {
                await options.fallbackListenerOnCacheMiss(p, gi, event);
            }
        }
    }
}

/**
 * Goal listener that cleans up the cache restores after a goal has been run.
 * @param options The options for caching
 * @param classifier Whether only a specific classifier, as defined in the options, needs to be removed. If omitted,
 *                   all classifiers are removed.
 */
export function removeGoalArtifacts(options: GoalCacheOptions,
                                    classifier?: string): GoalProjectListenerRegistration {
    return {
        name: "remove-archived-artifacts",
        listener: async (p, gi) =>  {
            const cacheEnabled = gi.configuration.sdm.cache.enabled as boolean;
            if (cacheEnabled) {
                const goalCache = gi.configuration.sdm.goalCache as GoalCache;
                return goalCache.remove(gi.id, classifier);
            }
        },
        pushTest: options.pushTest,
        events: [GoalProjectListenerEvent.after],
    };
}
