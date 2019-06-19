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
    AutomationContextAware,
    CommandIncoming,
    EventIncoming,
    MutationNoCacheOptions,
} from "@atomist/automation-client";
import { SdmContext } from "@atomist/sdm";
import { CreateJob } from "../../typings/types";

export enum JobTaskType {

    Event = "event",

    Command = "command",
}

export interface JobTask {
    name: string;
    payload: EventIncoming | CommandIncoming | any;
    type: JobTaskType | string;
}

/**
 * Create a AtmJob in the backend with the provided name and tasks
 */
export async function createJob(name: string,
                                tasks: JobTask[],
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
                data: JSON.stringify({
                    type: t.type,
                    payload: t.payload,
                }),
            })),
        },
        options: MutationNoCacheOptions,
    });

    return { id: result.createAtmJob.id };
}
