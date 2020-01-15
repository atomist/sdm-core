import { logger } from "@atomist/automation-client/lib/util/logger";
import { testProgressReporter } from "@atomist/sdm/lib/api-helper/goal/progress/progress";
import {
    doWithProject,
    ProjectAwareGoalInvocation,
} from "@atomist/sdm/lib/api-helper/project/withProject";
import { ExecuteGoalResult } from "@atomist/sdm/lib/api/goal/ExecuteGoalResult";
import {
    goal,
    GoalWithFulfillment,
} from "@atomist/sdm/lib/api/goal/GoalWithFulfillment";
import { SdmGoalState } from "@atomist/sdm/lib/typings/types";
import { FulfillableGoalDetails } from "@atomist/sdm/src/lib/api/goal/GoalWithFulfillment";

const PipelineProgressReporter = testProgressReporter({
    test: /Running step '(.*)'/i,
    phase: "$1",
});

/**
 * Single step in the Goal pipeline execution
 */
export interface PipelineStep {
    /** Name of the step */
    name: string;
    /** Function that gets called when the step should execute */
    run: (gi: ProjectAwareGoalInvocation, context: Record<string, any>) => Promise<void | ExecuteGoalResult>;
    /** Optional function to indicate if the step should run */
    runWhen?: (gi: ProjectAwareGoalInvocation) => Promise<boolean>;
}

/**
 * Execute provided pipeline steps in the order they are provided or until one fails
 */
export async function runPipeline(gi: ProjectAwareGoalInvocation, ...steps: PipelineStep[]): Promise<void | ExecuteGoalResult> {
    const { progressLog } = gi;
    const context: Record<string, any> = {};

    for (const step of steps) {
        try {
            if (!step.runWhen || !!(await step.runWhen(gi))) {
                progressLog.write(`Running step '${step.name}'`);

                const result = await step.run(gi, context);
                if (!!result && (result.code !== 0 || result.state !== SdmGoalState.failure)) {
                    return result;
                }
            } else {
                progressLog.write(`Skipping step '${step.name}'`);
            }
        } catch (e) {
            logger.warn(`Step '${step.name}' errored with:`);
            logger.warn(e);
            return {
                state: SdmGoalState.failure,
                phase: step.name,
            }
        }
    }
}

/**
 * Goal that executes the provided pipeline steps
 */
export function pipeline(details: FulfillableGoalDetails, ...steps: PipelineStep[]): GoalWithFulfillment {
    return goal(
        details,
        doWithProject(async gi => {
            return runPipeline(gi, ...steps);
        }, { readOnly: false, detachHead: true }),
        { progressReporter: PipelineProgressReporter });
}
