import {
    AutomationContextAware,
    CommandIncoming,
    EventIncoming,
    MutationNoCacheOptions,
} from "@atomist/automation-client";
import { SdmContext } from "@atomist/sdm";
import { CreateJob } from "../../typings/types";

/**
 * Create a AtmJob in the backend with the provided name and tasks
 */
export async function createJob(name: string,
                                tasks: Array<{ name: string, payload: CommandIncoming | EventIncoming }>,
                                ctx: SdmContext): Promise<{ id: string }> {
    const context = ctx.context as any as AutomationContextAware;
    const owner = context.context.name;
    const data = JSON.stringify(context.trigger);

    const result = await ctx.context.graphClient.mutate<CreateJob.Mutation, CreateJob.Variables>({
        name: "CreateJob",
        variables: {
            name,
            owner,
            data,
            tasks: tasks.map(t => ({
                name: t.name,
                data: JSON.stringify(t.payload),
            })),
        },
        options: MutationNoCacheOptions,
    });

    return { id: result.createAtmJob.id };
}


