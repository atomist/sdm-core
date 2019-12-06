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

import { PushListenerInvocation } from "@atomist/sdm";
import * as _ from "lodash";
import * as os from "os";

const PlaceholderExpression = /\$\{([.a-zA-Z_-]+)([.:0-9a-zA-Z-_ \" ]+)*\}/g;

export async function resolvePlaceholder(value: string, pli: PushListenerInvocation): Promise<string> {
    if (!PlaceholderExpression.test(value)) {
        return value;
    }
    PlaceholderExpression.lastIndex = 0;
    let currentValue = value;
    let result: RegExpExecArray;
    // tslint:disable-next-line:no-conditional-assignment
    while (result = PlaceholderExpression.exec(currentValue)) {
        const fm = result[0];
        let envValue = _.get(pli, result[1]);
        if (result[1] === "home") {
            envValue = os.homedir();
        }
        const defaultValue = result[2] ? result[2].trim().slice(1) : undefined;

        if (envValue) {
            currentValue = currentValue.split(fm).join(envValue);
        } else if (defaultValue) {
            currentValue = currentValue.split(fm).join(defaultValue);
        } else {
            throw new Error(`Placeholder '${result[1]}' can't be resolved`);
        }
        PlaceholderExpression.lastIndex = 0;
    }
    return currentValue;
}
