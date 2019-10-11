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
    guid,
    LeveledLogMethod,
    QueryNoCacheOptions,
} from "@atomist/automation-client";
import {
    Build,
    ExecuteGoalResult,
    GoalInvocation,
    ProgressLog,
    SdmContext,
    SdmGoalEvent,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { getGoalVersion } from "../../internal/delivery/build/local/projectVersioner";
import { K8sNamespaceFile } from "../../pack/k8s/KubernetesGoalScheduler";
import {
    DockerRegistryProvider,
    Password,
    PushFields,
} from "../../typings/types";
import {
    postBuildWebhook,
    postLinkImageWebhook,
} from "../../util/webhook/ImageLink";
import {
    ContainerInput,
    ContainerOutput,
    ContainerProjectHome,
    ContainerResult,
    GoalContainer,
    GoalContainerSecret,
} from "./container";
import Images = PushFields.Images;

/**
 * Simple test to see if SDM is running in Kubernetes.  It is called
 * from a non-async function, so it must be non-async.
 *
 * @return `true` if process is running in Kubernetes, `false` otherwise.
 */
export function runningInK8s(): boolean {
    return fs.pathExistsSync(K8sNamespaceFile);
}

/**
 * Return environment variables required by the container goal
 * execution machinery.
 *
 * @param goalEvent SDM goal event being executed as a container goal
 * @param ctx SDM context for goal execution
 * @return SDM goal environment variables
 */
export async function containerEnvVars(goalEvent: SdmGoalEvent, ctx: SdmContext): Promise<Array<{ name: string, value: string }>> {
    const version = await getGoalVersion({
        owner: goalEvent.repo.owner,
        repo: goalEvent.repo.name,
        providerId: goalEvent.repo.providerId,
        sha: goalEvent.sha,
        branch: goalEvent.branch,
        context: ctx.context,
    });
    return [{
        name: "ATOMIST_WORKSPACE_ID",
        value: ctx.context.workspaceId,
    }, {
        name: "ATOMIST_SLUG",
        value: `${goalEvent.repo.owner}/${goalEvent.repo.name}`,
    }, {
        name: "ATOMIST_OWNER",
        value: goalEvent.repo.owner,
    }, {
        name: "ATOMIST_REPO",
        value: goalEvent.repo.name,
    }, {
        name: "ATOMIST_SHA",
        value: goalEvent.sha,
    }, {
        name: "ATOMIST_BRANCH",
        value: goalEvent.branch,
    }, {
        name: "ATOMIST_VERSION",
        value: version,
    }, {
        name: "ATOMIST_GOAL",
        value: `${ContainerInput}/goal.json`,
    }, {
        name: "ATOMIST_SECRETS",
        value: `${ContainerInput}/secrets.json`,
    }, {
        name: "ATOMIST_RESULT",
        value: ContainerResult,
    }, {
        name: "ATOMIST_INPUT_DIR",
        value: ContainerInput,
    }, {
        name: "ATOMIST_OUTPUT_DIR",
        value: ContainerOutput,
    }, {
        name: "ATOMIST_PROJECT_DIR",
        value: ContainerProjectHome,
    }].filter(e => !!e.value);
}

/**
 * Copy cloned project to location that can be mounted into container.
 * It ensures the destination direction exists and is empty.  If it
 * fails it throws an error and tries to ensure the destination
 * directory does not exist.
 *
 * @param src Location of project directory
 * @param dest Location to copy project to
 */
export async function copyProject(src: string, dest: string): Promise<void> {
    try {
        await fs.emptyDir(dest);
    } catch (e) {
        e.message = `Failed to empty directory '${dest}'`;
        throw e;
    }
    try {
        await fs.copy(src, dest);
    } catch (e) {
        e.message = `Failed to copy project from '${src}' to '${dest}'`;
        try {
            await fs.remove(dest);
        } catch (err) {
            e.message += `; Failed to clean up '${dest}': ${err.message}`;
        }
        throw e;
    }
}

export async function prepareInputAndOutput(input: string, output: string, gi: GoalInvocation): Promise<void> {
    try {
        await fs.emptyDir(input);
    } catch (e) {
        e.message = `Failed to empty directory '${input}'`;
        throw e;
    }
    try {
        await fs.writeJson(path.join(input, "goal.json"), gi.goalEvent, { spaces: 2 });
    } catch (e) {
        e.message = `Failed to write metadata to '${input}'`;
        try {
            await fs.remove(input);
        } catch (err) {
            e.message += `; Failed to clean up '${input}': ${err.message}`;
        }
        throw e;
    }
    try {
        await fs.emptyDir(output);
    } catch (e) {
        e.message = `Failed to empty directory '${output}'`;
        throw e;
    }
}

export async function prepareSecrets(container: GoalContainer, input: string, gi: GoalInvocation)
    : Promise<{ env: Array<{ name: string, value: string }>, files: Array<{ hostPath: string, mountPath: string }> }> {
    const secrets = {
        env: [],
        files: [],
    };
    if (!!container.secrets) {
        if (!!container.secrets.env) {
            for (const secret of container.secrets.env) {
                if (!!secret.value.provider) {
                    const value = await prepareProviderSecret(secret.value, gi);
                    if (!!value) {
                        secrets.env.push({ name: secret.name, value });
                    }
                }
            }
        }
        if (!!container.secrets.files) {
            for (const secret of container.secrets.files) {
                if (!!secret.value.provider) {
                    const value = await prepareProviderSecret(secret.value, gi);
                    if (!!value) {
                        const hostPath = path.join(input, ".secrets", guid());
                        await fs.writeFile(hostPath, value);
                        secrets.files.push({
                            hostPath,
                            mountPath: secret.name,
                        });
                    }
                }
            }
        }
    }
    return secrets;
}

async function prepareProviderSecret(secret: GoalContainerSecret["value"], gi: GoalInvocation): Promise<string> {
    if (!!secret.provider) {
        switch (secret.provider.type) {
            case "docker":
                return prepareDockerProviderSecret(secret.provider.names || [], gi);
            case "scm":
                return JSON.stringify(gi.credentials);
            case "npm":
                return undefined;
            case "maven2":
                return undefined;
            case "atomist":
                return gi.configuration.apiKey;
            default:
                return undefined;
        }
    }
    return undefined;
}

async function prepareDockerProviderSecret(names: string[], gi: GoalInvocation): Promise<string> {
    const { context } = gi;
    const dockerRegistries = await context.graphClient.query<DockerRegistryProvider.Query, DockerRegistryProvider.Variables>({
        name: "DockerRegistryProvider",
        options: QueryNoCacheOptions,
    });

    const dockerConfig = {
        auths: {},
    } as any;

    if (!!dockerRegistries && !!dockerRegistries.DockerRegistryProvider) {

        for (const dockerRegistry of dockerRegistries.DockerRegistryProvider.filter(d => names.length === 0 || names.includes(d.name))) {

            const credential = await context.graphClient.query<Password.Query, Password.Variables>({
                name: "Password",
                variables: {
                    id: dockerRegistry.credential.id,
                },
            });

            dockerConfig.auths[dockerRegistry.url] = {
                auth: Buffer.from(credential.Password[0].owner.login + ":" + credential.Password[0].secret).toString("base64"),
            };
        }
    }

    return JSON.stringify(dockerConfig);
}

/**
 * Write to client and progress logs.  Add newline to progress log.
 *
 * @param msg Message to write, should not have newline at end
 * @param l Logger method, e.g., `logger.warn`
 * @param p Progress log
 */
export function loglog(msg: string, l: LeveledLogMethod, p: ProgressLog): void {
    l(msg);
    p.write(msg + "\n");
}

export async function processResult(result: any,
                                    gi: GoalInvocation): Promise<ExecuteGoalResult | undefined> {
    const { goalEvent, context } = gi;
    if (!!result) {
        if (result.SdmGoal) {
            const goal = result.SdmGoal as SdmGoalEvent;
            const r = {
                state: goal.state,
                phase: goal.phase,
                description: goal.description,
                externalUrls: goal.externalUrls,
                data: convertData(goal.data),
            };

            const builds = _.get(goal, "push.builds") as Build[];
            if (!!builds) {
                for (const build of builds) {
                    await postBuildWebhook(
                        goalEvent.repo.owner,
                        goalEvent.repo.name,
                        goalEvent.branch,
                        goalEvent.sha,
                        build.status as any,
                        context.workspaceId);
                }
            }

            const images = _.get(goal, "push.after.images") as Images[];
            if (!!images) {
                for (const image of images) {
                    await postLinkImageWebhook(
                        goalEvent.repo.owner,
                        goalEvent.repo.name,
                        goalEvent.sha,
                        image.imageName,
                        context.workspaceId,
                    );
                }
            }

            return r;
        } else {
            return {
                ...result,
                data: convertData(result.data),
            };
        }
    }
    return undefined;
}

function convertData(data: any): string {
    return !!data && typeof data !== "string" ? JSON.stringify(data) : data;
}
