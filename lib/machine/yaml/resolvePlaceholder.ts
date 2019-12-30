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

import { logger } from "@atomist/automation-client/lib/util/logger";
import { RepoContext } from "@atomist/sdm/lib/api/context/SdmContext";
import { SdmGoalEvent } from "@atomist/sdm/lib/api/goal/SdmGoalEvent";
import * as _ from "lodash";
import * as os from "os";
import { getGoalVersion } from "../../internal/delivery/build/local/projectVersioner";
import { camelCase } from "./util";

const PlaceholderExpression = /\$\{([.a-zA-Z_-]+)([.:0-9a-zA-Z-_ \" ]+)*\}/g;

export async function resolvePlaceholder(value: string,
                                         goal: SdmGoalEvent,
                                         ctx: Pick<RepoContext, "configuration" | "context">,
                                         parameters: Record<string, any>,
                                         raiseError: boolean = true): Promise<string> {
    if (!PlaceholderExpression.test(value)) {
        return value;
    }
    PlaceholderExpression.lastIndex = 0;
    let currentValue = value;
    let result: RegExpExecArray;
    // tslint:disable-next-line:no-conditional-assignment
    while (result = PlaceholderExpression.exec(currentValue)) {
        const fm = result[0];
        let envValue = _.get(goal, result[1]) ||
            _.get(ctx.configuration, result[1]) ||
            _.get(ctx.configuration, camelCase(result[1])) ||
            _.get(ctx.context, result[1]) ||
            _.get(ctx.context, camelCase(result[1])) ||
            _.get({ parameters }, result[1]) ||
            _.get({ parameters }, camelCase(result[1]));
        if (result[1] === "home") {
            envValue = os.userInfo().homedir;
        } else if (result[1] === "push.after.version" && !!goal) {
            envValue = await getGoalVersion({
                context: ctx.context,
                owner: goal.repo.owner,
                repo: goal.repo.name,
                providerId: goal.repo.providerId,
                branch: goal.branch,
                sha: goal.sha,
            });
        }
        const defaultValue = result[2] ? result[2].trim().slice(1) : undefined;

        if (typeof envValue === "string") {
            currentValue = currentValue.split(fm).join(envValue);
            PlaceholderExpression.lastIndex = 0;
        } else if (typeof envValue === "object" && value === fm) {
            return envValue;
        } else if (defaultValue) {
            currentValue = currentValue.split(fm).join(defaultValue);
            PlaceholderExpression.lastIndex = 0;
        } else if (raiseError) {
            logger.warn(`Placeholder replacement failed for '%s', value: '%j', goal: '%j', parameters: '%j'`,
                result[1], value, goal, parameters);
            throw new Error(`Placeholder '${result[1]}' can't be resolved`);
        }
    }
    return currentValue;
}
