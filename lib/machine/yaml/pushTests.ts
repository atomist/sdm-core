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
    and,
    hasFile,
    hasFileContaining,
    isBranch,
    isGoal,
    isMaterialChange,
    isRepo,
    not,
    or,
    pushTest,
    PushTest,
    SdmGoalState,
    StatefulPushListenerInvocation,
    ToDefaultBranch,
} from "@atomist/sdm";
import * as changeCase from "change-case";
import { toArray } from "../../util/misc/array";

export type PushTestMaker<G extends Record<string, any> = any> =
    (params: G) => ((pli: StatefulPushListenerInvocation) => Promise<boolean>) | Promise<PushTest> | PushTest;

function getGlobPatterns(test: any): string[] {
    const pattern = test.globPattern || test.pattern || test.globPatterns || test.patterns;
    return toArray(pattern);
}

export async function mapTests(tests: any,
                               additionalTests: Record<string, PushTest>,
                               extensionTests: Record<string, PushTestMaker>): Promise<PushTest | PushTest[]> {
    const newTests = [];
    for (const t of toArray(tests)) {
        newTests.push(await mapTest(t, additionalTests, extensionTests));
    }
    return newTests;
}

// tslint:disable-next-line:cyclomatic-complexity
export async function mapTest(test: any,
                              additionalTests: Record<string, PushTest>,
                              extensionTests: Record<string, PushTestMaker>): Promise<PushTest> {
    if (test.hasFile) {
        return hasFile(test.hasFile);
    } else if (test.isRepo) {
        return isRepo(typeof test.isRepo === "string" ? new RegExp(test.isRepo) : test.isRepo);
    } else if (test.isBranch) {
        return isBranch(typeof test.isBranch === "string" ? new RegExp(test.isBranch) : test.isBranch);
    } else if (["IsDefaultBranch", "ToDefaultBranch"].includes(changeCase.camel(test))) {
        return ToDefaultBranch;
    } else if (test.isGoal) {
        return isGoal(
            typeof test.isGoal.name === "string" ? new RegExp(test.isGoal.name) : test.isGoal.name,
            test.isGoal.state || SdmGoalState.success,
            test.isGoal.test ? await mapTest(test.isGoal.test, additionalTests, extensionTests) : undefined);
    } else if (test.isMaterialChange) {
        return isMaterialChange({
            directories: toArray(test.isMaterialChange.directories),
            extensions: toArray(test.isMaterialChange.extensions),
            files: toArray(test.isMaterialChange.files),
            globs: getGlobPatterns(test.isMaterialChange),
        });
    } else if (test.hasFileContaining) {
        return hasFileContaining(
            getGlobPatterns(test.hasFileContaining),
            typeof test.hasFileContaining.content === "string" ? new RegExp(test.hasFileContaining.content) : test.hasFileContaining.content);
    } else if (test.not) {
        return not(await mapTest(test.not, additionalTests, extensionTests));
    } else if (test.and) {
        return and(...toArray(await mapTests(test.and, additionalTests, extensionTests)));
    } else if (test.or) {
        return or(...toArray(await mapTests(test.or, additionalTests, extensionTests)));
    } else if (typeof test === "string" && !!additionalTests[test]) {
        return additionalTests[test];
    } else if (typeof test === "function") {
        return pushTest(test.toString(), test);
    } else {
        for (const extTestName in extensionTests) {
            if (!!test[extTestName] || extTestName === test) {
                const extTest = await extensionTests[extTestName](test[extTestName]) as any;
                if (!!extTest.name && !!extTest.mapping) {
                    return extTest;
                } else {
                    return pushTest(extTestName, extTest);
                }
            }
        }
    }
    throw new Error(`Unable to construct push test from '${JSON.stringify(test)}'`);
}
