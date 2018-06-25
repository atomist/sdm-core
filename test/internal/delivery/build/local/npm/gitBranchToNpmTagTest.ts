import * as assert from "assert";
import { gitBranchToNpmTag } from "../../../../../../src/internal/delivery/build/local/npm/executePublish";

describe("git branch to npm tag", () => {

    it("prefixes it with branch", () => {
        const input = "hello";
        const result = gitBranchToNpmTag(input)
        assert.equal(result, "branch-" + input)
    });

    it("replaces slash with something", () => {
        const input = "hello/branch";
        const result = gitBranchToNpmTag(input);
        assert(!result.includes("/"));
    });
});
