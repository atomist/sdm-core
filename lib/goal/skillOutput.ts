import { GoalExecutionListener } from "@atomist/sdm/lib/api/listener/GoalStatusListener";
import { SdmGoalState } from "@atomist/sdm/lib/typings/types";
import {
    CustomSkillOutputInput,
    IngestSkillOutputMutation,
    IngestSkillOutputMutationVariables,
} from "../typings/types";
import {
    CacheEntry,
    CacheOutputGoalDataKey,
} from "./cache/goalCaching";

/**
 * GoalExecutionListener implementation that raises SkillOutput entities for persistent goal caches
 * that carry a type property
 */
export const SkillOutputGoalExecutionListener: GoalExecutionListener = async gi => {
    const { goalEvent, context, configuration, result, error } = gi;

    // Check that the goal is successful
    if (!!error) {
        return;
    } else if (!!result && (result.code !== 0 || result.state === SdmGoalState.failure)) {
        return;
    } else if (goalEvent.state === SdmGoalState.failure) {
        return;
    }
    
    const data = JSON.parse(goalEvent.data || "{}");
    const entries: Array<CacheEntry & { type: string, uri: string }> = data[CacheOutputGoalDataKey] || [];

    for (const entry of entries.filter(e => !!e.type && !!e.classifier && !!e.uri)) {
        const skillOutput: CustomSkillOutputInput = {
            _branch: goalEvent.branch,
            _sha: goalEvent.sha,
            _owner: goalEvent.repo.owner,
            _repo: goalEvent.repo.name,
            classifier: entry.classifier.slice(`${gi.context.workspaceId}/`.length),
            type: entry.type,
            uri: entry.uri,
            content: undefined,
            correlationId: context.correlationId,
            skill: {
                name: configuration.name,
                version: configuration.version,
            },
        };
        await context.graphClient.mutate<IngestSkillOutputMutation, IngestSkillOutputMutationVariables>({
            name: "IngestSkillOutput",
            variables: {
                output: skillOutput,
            },
        });
    }
};
