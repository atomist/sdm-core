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

import * as camelcaseKeys from "camelcase-keys";
import * as changeCase from "change-case";

/**
 * Watches the provided paths for changes when in watch mode
 */
export function watchPaths(paths: string[]): void {
    process.env.ATOMIST_WATCH_PATHS =
        [...(process.env.ATOMIST_WATCH_PATHS?.split(",") || []), ...paths].join(",");
}

export function camelCase(obj: any): any {
    if (typeof obj === "string") {
        return camelCaseString(obj);
    } else if (Array.isArray(obj)) {
        return obj.map(camelCase);
    }
    return camelcaseKeys(obj || {}, { deep: true });
}

function camelCaseString(key: string): string {
    return key.split(".").map(k => changeCase.camel(k)).join(".");
}
