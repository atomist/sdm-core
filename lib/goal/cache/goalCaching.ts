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
    RepoRef,
} from "@atomist/automation-client";
import { gatherFromFiles } from "@atomist/automation-client/lib/project/util/projectUtils";
import {
    AnyPush,
    ExecuteGoalResult,
    GoalInvocation,
    GoalProjectListener,
    GoalProjectListenerEvent,
    GoalProjectListenerRegistration,
    ProgressLog,
    PushTest,
} from "@atomist/sdm";
import * as _ from "lodash";

export interface GoalArtifactCache {
    putInCache(id: RepoRef, project: Project, file: string[], log: ProgressLog): Promise<void>;
    retrieveFromCache(id: RepoRef, project: Project, log: ProgressLog): Promise<void>;
    removeFromCache(id: RepoRef): Promise<void>;
}

const defaultGoalArtifactCacheOptions: GoalArtifactCacheOptions = {
    pushTest: AnyPush,
    globPattern: "**/*.jar",
    fallbackListenerOnCacheMiss: () => { throw Error("No entry found in cache"); },
};

export interface GoalArtifactCacheOptions {
    pushTest: PushTest;
    globPattern: string;
    fallbackListenerOnCacheMiss: GoalProjectListener;
}

export function cacheGoalArtifacts(artifactArchiveCacher: GoalArtifactCache,
                                   options: Partial<GoalArtifactCacheOptions> = {}): GoalProjectListenerRegistration {
    const optionsToUse = {
        ...defaultGoalArtifactCacheOptions,
        ...options,
    };

    return {
        name: "cache-artifacts",
        listener: archiveAndCacheArtifacts,
        pushTest: optionsToUse.pushTest,
    };

    async function archiveAndCacheArtifacts(p: GitProject,
                                            gi: GoalInvocation,
                                            event: GoalProjectListenerEvent): Promise<void | ExecuteGoalResult> {
        if (optionsToUse.pushTest !== undefined && await optionsToUse.pushTest.mapping({project: p, push: gi.goalEvent.push, ...gi})) {
            if (event === GoalProjectListenerEvent.after) {
                const jars = await getFilePathsThroughPattern(p, optionsToUse.globPattern);
                if (!_.isEmpty(jars)) {
                    return artifactArchiveCacher.putInCache(gi.id, p, jars, gi.progressLog);
                }
            }
        }
    }
}

export function getFilePathsThroughPattern(project: Project, globPattern: string): Promise<string[]> {
    return gatherFromFiles(project, globPattern, async f => f.path);
}

export function restoreGoalArtifacts(artifactArchiveCache: GoalArtifactCache,
                                     options: Partial<GoalArtifactCacheOptions> = {}): GoalProjectListenerRegistration {
    const optionsToUse = {
        ...defaultGoalArtifactCacheOptions,
        ...options,
    };

    return {
        name: "restore-artifacts",
        listener: retrieveAndRestoreArtifacts,
        pushTest: optionsToUse.pushTest,
    };

    async function retrieveAndRestoreArtifacts(p: GitProject,
                                               gi: GoalInvocation,
                                               event: GoalProjectListenerEvent): Promise<void | ExecuteGoalResult> {
        if (optionsToUse.pushTest !== undefined && await optionsToUse.pushTest.mapping({project: p, push: gi.goalEvent.push, ...gi})) {
            if (event === GoalProjectListenerEvent.before) {
                return artifactArchiveCache.retrieveFromCache(gi.id, p, gi.progressLog)
                    .catch(async () => { await optionsToUse.fallbackListenerOnCacheMiss(p, gi, event); });
            }
        }
    }
}

export function removeGoalArtifacts(artifactArchiveCache: GoalArtifactCache,
                                    options: Partial<GoalArtifactCacheOptions> = {}): GoalProjectListenerRegistration {
    const optionsToUse = {
        ...defaultGoalArtifactCacheOptions,
        ...options,
    };

    return {
        name: "remove-archived-artifacts",
        listener: async (p, gi, event) => {
            if (optionsToUse.pushTest !== undefined && await optionsToUse.pushTest.mapping({project: p, push: gi.goalEvent.push, ...gi})) {
                if (event === GoalProjectListenerEvent.after) {
                    return artifactArchiveCache.removeFromCache(gi.id);
                }
            }
        },
        pushTest: optionsToUse.pushTest,
    };
}
