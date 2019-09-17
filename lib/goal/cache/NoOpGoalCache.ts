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
    logger,
    Project,
} from "@atomist/automation-client";
import { GoalInvocation } from "@atomist/sdm";
import { GoalCache } from "./goalCaching";

/**
 * Cache implementation that doesn't cache anything and will always trigger the fallback.
 */
export class NoOpGoalCache implements GoalCache {
    public async put(gi: GoalInvocation, project: GitProject, files: string[], classifier?: string): Promise<void> {
        logger.debug(`Warning: No-Op goal cache in use; no cache will be preserved!`);
    }

    public async remove(gi: GoalInvocation, classifier?: string): Promise<void> {
        logger.debug(`Warning: No-Op goal cache in use; no cache will be removed!`);
    }

    public async retrieve(gi: GoalInvocation, project: Project, classifier?: string): Promise<void> {
        throw Error("No cache entry");
    }
}
