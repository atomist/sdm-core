import { HandlerContext } from "@atomist/automation-client";
import { PushFields, RemoteRepoRef } from "@atomist/sdm";
import * as stringify from "json-stringify-safe";
import { PushForCommit, RepoBranchTips } from "../../typings/types";

export async function fetchPushForCommit(context: HandlerContext, id: RemoteRepoRef, providerId: string): Promise<PushFields.Fragment> {
    const commitResult = await context.graphClient.query<PushForCommit.Query, PushForCommit.Variables>({
        name: "PushForCommit", variables: {
            owner: id.owner, repo: id.repo, providerId, branch: id.branch, sha: id.sha,
        },
    });

    if (!commitResult || !commitResult.Commit || commitResult.Commit.length === 0) {
        throw new Error("Could not find commit for " + stringify(id));
    }
    const commit = commitResult.Commit[0];
    if (!commit.pushes || commit.pushes.length === 0) {
        throw new Error("Could not find push for " + stringify(id));
    }
    return commit.pushes[0];
}

export async function fetchDefaultBranchTip(ctx: HandlerContext, repositoryId: { repo: string, owner: string, providerId: string }) {
    const result = await ctx.graphClient.query<RepoBranchTips.Query, RepoBranchTips.Variables>(
        { name: "RepoBranchTips", variables: { name: repositoryId.repo, owner: repositoryId.owner } });
    if (!result || !result.Repo || result.Repo.length === 0) {
        throw new Error(`Repository not found: ${repositoryId.owner}/${repositoryId.repo}`);
    }
    const repo = result.Repo.find(r => r.org.provider.providerId === repositoryId.providerId);
    if (!repo) {
        throw new Error(`Repository not found: ${repositoryId.owner}/${repositoryId.repo} provider ${repositoryId.providerId}`);
    }
    return repo;
}

export function tipOfBranch(repo: RepoBranchTips.Repo, branchName: string) {
    const branchData = repo.branches.find(b => b.name === branchName);
    if (!branchData) {
        throw new Error("Branch not found: " + branchName);
    }
    return branchData.commit.sha;
}
