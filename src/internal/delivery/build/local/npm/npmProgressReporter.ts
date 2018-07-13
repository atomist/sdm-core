/*
 * Copyright © 2018 Atomist, Inc.
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
    ProgressTest,
    testProgressReporter,
} from "@atomist/sdm/api-helper/goal/progress/progress";

export const NpmProgressTests: ProgressTest[] = [{
    test: /Invoking goal hook: pre/g,
    label: "installing dependencies",
}, {
    test: /> atomist git/g,
    label: "generating resources",
}, {
    test: /> tsc --project \./g,
    label: "compiling sources",
}, {
    test: /> nyc mocha/g,
    label: "testing",
}, {
    test: /> mocha --exit/g,
    label: "testing",
}, {
    test: /Sending build context to Docker daemon/g,
    label: "building Docker image",
}, {
    test: /The push refers to a repository/g,
    label: "pushing Docker image",
}];

export const NpmProgressReporter = testProgressReporter(...NpmProgressTests);
