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
    HandleCommand,
    HandlerContext,
    MappedParameter,
    MappedParameters,
    Parameter,
    Secret,
    Secrets,
    Success,
    Value,
} from "@atomist/automation-client";
import { Parameters } from "@atomist/automation-client/decorators";
import { commandHandlerFrom } from "@atomist/automation-client/onCommand";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { chooseAndSetGoals } from "@atomist/sdm/api-helper/goal/chooseAndSetGoals";
import { SdmGoalImplementationMapper } from "@atomist/sdm/api/goal/support/SdmGoalImplementationMapper";
import { GoalsSetListener } from "@atomist/sdm/api/listener/GoalsSetListener";
import { GoalSetter } from "@atomist/sdm/api/mapping/GoalSetter";
import { ProjectLoader } from "@atomist/sdm/spi/project/ProjectLoader";
import { RepoRefResolver } from "@atomist/sdm/spi/repo-ref/RepoRefResolver";
import { PushFields } from "@atomist/sdm/typings/types";
import {
    bold,
    codeLine,
    italic,
} from "@atomist/slack-messages";
import * as stringify from "json-stringify-safe";
import {
    PushForCommit,
    RepoBranchTips,
} from "../../../../typings/types";
import {
    success,
    warning,
} from "../../../../util/slack/messages";

@Parameters()
export class ResetGoalsParameters {

    @Secret(Secrets.UserToken)
    public githubToken: string;

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo: string;

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

    @Parameter({required: false})
    public sha: string;

    @Parameter({required: false})
    public branch: string;

    @Value("name")
    public name: string;

    @Value("version")
    public version: string;

}

export function resetGoalsCommand(rules: {
    projectLoader: ProjectLoader,
    repoRefResolver: RepoRefResolver,
    goalsListeners: GoalsSetListener[],
    goalSetter: GoalSetter,
    implementationMapping: SdmGoalImplementationMapper,
    name: string,
}): HandleCommand {
    return commandHandlerFrom(resetGoalsOnCommit(rules),
        ResetGoalsParameters,
        "ResetGoalsOnCommit",
        "Set goals",
        [`plan goals ${rules.name}`, "plan goals", `reset goals ${rules.name}`, "reset goals"]);
}

function resetGoalsOnCommit(rules: {
    projectLoader: ProjectLoader,
    repoRefResolver: RepoRefResolver,
    goalsListeners: GoalsSetListener[],
    goalSetter: GoalSetter,
    implementationMapping: SdmGoalImplementationMapper,
}) {
    const {projectLoader, goalsListeners, goalSetter, implementationMapping, repoRefResolver} = rules;
    return async (ctx: HandlerContext, commandParams: ResetGoalsParameters) => {
        // figure out which commit
        const repoData = await fetchDefaultBranchTip(ctx, commandParams);
        const branch = commandParams.branch || repoData.defaultBranch;
        const sha = commandParams.sha || tipOfBranch(repoData, branch);
        const id = GitHubRepoRef.from({owner: commandParams.owner, repo: commandParams.repo, sha, branch});

        const push = await fetchPushForCommit(ctx, id, commandParams.providerId);
        const credentials = {token: commandParams.githubToken};

        const goals = await chooseAndSetGoals({
            projectLoader,
            repoRefResolver,
            goalsListeners,
            goalSetter,
            implementationMapping,
        }, {
            context: ctx,
            credentials,
            push,
        });

        if (goals) {
            await ctx.messageClient.respond(success(
                "Plan Goals",
                `Successfully planned goals on ${codeLine(sha.slice(0, 7))} of ${
                    bold(`${commandParams.owner}/${commandParams.repo}/${branch}`)} to ${italic(goals.name)}`,
                {
                    footer: `${commandParams.name}:${commandParams.version}`,
                }));
        } else {
            await ctx.messageClient.respond(warning(
                "Plan Goals",
                `No goals found for ${codeLine(sha.slice(0, 7))} of ${
                    bold(`${commandParams.owner}/${commandParams.repo}/${branch}`)}`,
                ctx,
                {
                    footer: `${commandParams.name}:${commandParams.version}`,
                }));
        }

        return Success;
    };
}

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
        {name: "RepoBranchTips", variables: {name: repositoryId.repo, owner: repositoryId.owner}});
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
