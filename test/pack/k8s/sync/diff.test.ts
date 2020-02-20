/*
 * Copyright © 2020 Atomist, Inc.
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

import { LocalProject } from "@atomist/automation-client/lib/project/local/LocalProject";
import { execPromise } from "@atomist/automation-client/lib/util/child_process";
import { SdmGoalEvent } from "@atomist/sdm/lib/api/goal/SdmGoalEvent";
import { ProgressLog } from "@atomist/sdm/lib/spi/log/ProgressLog";
import * as assert from "power-assert";
import {
    diffPush,
    parseNameStatusDiff,
    PushDiff,
} from "../../../../lib/pack/k8s/sync/diff";

describe("pack/k8s/sync/diff", () => {

    describe("parseNameStatusDiff", () => {

        it("should safely parse nothing", () => {
            const s = "87c6ba8a3e2e3961d318fa8c50885b1ca0c4e1dc";
            ["", "\n", "\0", "\0\n"].forEach(d => {
                const c = parseNameStatusDiff(s, d);
                const e: PushDiff[] = [];
                assert.deepStrictEqual(c, e);
            });
        });

        it("should parse valid input", () => {
            const s = "87c6ba8a3e2e3961d318fa8c50885b1ca0c4e1dc";
            const ds = [
                "D\0a.yaml\0A\0aa.json\0D\0b.yml\0A\0d.json\0M\0e.json\0A\0fyml\0A\0i/j/k/l.json\0A\0s t.json\0M\0x.yaml\0",
                "D\0a.yaml\0A\0aa.json\0D\0b.yml\0A\0d.json\0M\0e.json\0A\0fyml\0A\0i/j/k/l.json\0A\0s t.json\0M\0x.yaml\0\n",
            ];
            ds.forEach(d => {
                const c = parseNameStatusDiff(s, d);
                const e: PushDiff[] = [
                    { sha: s, change: "delete", path: "a.yaml" },
                    { sha: s, change: "delete", path: "b.yml" },
                    { sha: s, change: "apply", path: "aa.json" },
                    { sha: s, change: "apply", path: "d.json" },
                    { sha: s, change: "apply", path: "e.json" },
                    { sha: s, change: "apply", path: "s t.json" },
                    { sha: s, change: "apply", path: "x.yaml" },
                ];
                assert.deepStrictEqual(c, e);
            });
        });

        it("should sort the paths", () => {
            const s = "87c6ba8a3e2e3961d318fa8c50885b1ca0c4e1dc";
            const d = "D\0a.yaml\0A\0s t.json\0D\0b.yml\0A\0d.json\0M\0e.json\0A\0aa.json\0A\0i/j/k/l.json\0M\0x.yaml\0A\0f\0\n";
            const c = parseNameStatusDiff(s, d);
            const e: PushDiff[] = [
                { sha: s, change: "delete", path: "a.yaml" },
                { sha: s, change: "delete", path: "b.yml" },
                { sha: s, change: "apply", path: "aa.json" },
                { sha: s, change: "apply", path: "d.json" },
                { sha: s, change: "apply", path: "e.json" },
                { sha: s, change: "apply", path: "s t.json" },
                { sha: s, change: "apply", path: "x.yaml" },
            ];
            assert.deepStrictEqual(c, e);
        });

    });

    describe("diffPush", function(): void {

        // tslint:disable-next-line:no-invalid-this
        this.timeout(10000);

        before(async function(): Promise<void> {
            try {
                await execPromise("git", ["fetch", "origin", "test-branch-do-not-delete"]);
            } catch (e) {
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
        });

        it("should run git diff and parse output", async () => {
            const p: LocalProject = {
                baseDir: process.cwd(),
            } as any;
            const push: SdmGoalEvent["push"] = {
                commits: [
                    {
                        sha: "7ffbb06b4c048c975211468e043f8b9db5a11489",
                        message: "Senseless changes to test diffPush",
                    },
                    {
                        sha: "12eebb9d510839512654ea1eb870763c8426fd2c",
                        message: `Autofix: TypeScript header

[atomist:generated] [atomist:autofix=typescript_header]`,
                    },
                    {
                        sha: "3a00d2e66a6df267e41be9a5ea382ed1db8c4625",
                        message: `Change package description

[atomist:generated] [atomist:commit:test]
`,
                    },
                    {
                        sha: "bda8af958fdd6b4b5af6c774769de258d269fb8b",
                        message: "Update, add, delete files, plus ignored changes",
                    },
                ],
            };
            const t = "[atomist:commit:test]";
            let logs: string = "";
            const l: ProgressLog = {
                write: (d: string) => logs += d,
            } as any;
            const c = await diffPush(p, push, t, l);
            const e = [
                { change: "delete", path: "package-lock.json", sha: "7ffbb06b4c048c975211468e043f8b9db5a11489" },
                { change: "apply", path: "test.json", sha: "7ffbb06b4c048c975211468e043f8b9db5a11489" },
                { change: "apply", path: "tslint.json", sha: "7ffbb06b4c048c975211468e043f8b9db5a11489" },
                { change: "apply", path: "package-lock.json", sha: "12eebb9d510839512654ea1eb870763c8426fd2c" },
                { change: "delete", path: "package-lock.json", sha: "bda8af958fdd6b4b5af6c774769de258d269fb8b" },
                { change: "delete", path: "package.json", sha: "bda8af958fdd6b4b5af6c774769de258d269fb8b" },
                { change: "apply", path: "blaml.yaml", sha: "bda8af958fdd6b4b5af6c774769de258d269fb8b" },
                { change: "apply", path: "test.json", sha: "bda8af958fdd6b4b5af6c774769de258d269fb8b" },
            ];
            assert.deepStrictEqual(c, e);
        });

    });

});
