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
import { ReportProgress } from "@atomist/sdm/api/goal/progress/ReportProgress";

/**
 * Default progress tests for our NPM-based builds
 * @type {{test: RegExp; phase: string}[]}
 */
export const NpmProgressTests: ProgressTest[] = [{
    test: /Invoking goal hook: pre/g,
    phase: "pre-hook",
}, {
    test: /> atomist git/g,
    phase: "generating",
}, {
    test: /> tslint\./g,
    phase: "tslint",
}, {
    test: /> tsc --project \./g,
    phase: "tsc",
}, {
    test: /> nyc mocha/g,
    phase: "mocha",
}, {
    test: /> mocha --exit/g,
    phase: "mocha",
}, {
    test: /> mocha --require/g,
    phase: "mocha",
}, {
    test: /Sending build context to Docker daemon/g,
    phase: "docker build",
}, {
    test: /The push refers to a repository/g,
    phase: "docker push",
}, {
    test: /Invoking goal hook: post/g,
    phase: "post-hook",
}];

/**
 * Default ReportProgress for our NPM-based builds
 */
export const NpmProgressReporter: ReportProgress = testProgressReporter(...NpmProgressTests);
