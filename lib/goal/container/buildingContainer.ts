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
    HttpMethod,
    isValidSHA1,
    TokenCredentials,
} from "@atomist/automation-client";
import {
    DefaultGoalNameGenerator,
    FulfillableGoal,
    getGoalDefinitionFrom,
    Goal,
    GoalProjectListenerEvent,
    Goals,
    PlannedGoal,
    PlannedGoals,
    PushListenerInvocation,
} from "@atomist/sdm";
import * as _ from "lodash";
import { githubApi } from "../../internal/artifact/github/GitHubReleaseArtifactStore";
import {
    cachePut,
    cacheRestore,
} from "../cache/goalCaching";
import {
    Container,
    ContainerGoalDetails,
    ContainerProgressReporter,
    ContainerRegistration,
    GoalContainer,
} from "./container";
import {
    DockerContainerRegistration,
    executeDockerJob,
} from "./docker";
import {
    executeK8sJob,
    K8sContainerRegistration,
    k8sFulfillmentCallback,
} from "./k8s";
import { runningInK8s } from "./util";

export const GitImagePrefix = "git://";

export function isBuildingContainer(c: GoalContainer): boolean {
    return c.image.startsWith(GitImagePrefix);
}

export class BuildingContainer extends FulfillableGoal {

    public readonly details: ContainerGoalDetails;
    public readonly registration: ContainerRegistration;

    constructor(details: ContainerGoalDetails = {},
                registration: ContainerRegistration,
                ...dependsOn: Goal[]) {
        const prefix = "building-container" + (details.displayName ? `-${details.displayName}` : "");
        const detailsToUse = { ...details, isolate: true };
        super(getGoalDefinitionFrom(detailsToUse, DefaultGoalNameGenerator.generateName(prefix)), ...dependsOn);
        this.details = detailsToUse;
        this.registration = registration;

        let scheduler: "k8s" | "docker";

        if (!this.details.scheduler) {
            if (runningInK8s()) {
                scheduler = "k8s";
            } else {
                scheduler = "docker";
            }
        }

        this.addFulfillment({
            progressReporter: ContainerProgressReporter,
            goalExecutor: async gi => {
                const reg = gi.parameters.registration as ContainerRegistration;

                const c = new Container({ displayName: this.definition.displayName });
                (c as any).register = () => {
                };
                (c as any).addFulfillment = () => c;
                (c as any).addFulfillmentCallback = () => c;
                (c as any).withProjectListener = () => c;
                c.with(reg);

                if (scheduler === "k8s") {
                    return executeK8sJob(c, reg)(gi);
                } else if (scheduler === "docker") {
                    return executeDockerJob(c, reg)(gi);
                }
            },
            name: DefaultGoalNameGenerator.generateName(`building-container-docker-${this.definition.displayName}`),
        });

        this.addFulfillmentCallback({
            goal: this,
            callback: async (goal, context) => {
                const reg = JSON.parse((goal as any).parameters).registration as ContainerRegistration;
                if (scheduler === "k8s") {
                     const c = new Container({ displayName: this.definition.displayName });
                     return k8sFulfillmentCallback(c, reg)(goal, context);
                 }
                return goal;
            },
        });

        this.withProjectListener({
            name: "cache-restore",
            events: [GoalProjectListenerEvent.before],
            listener: async (p, gi, e) => {
                const reg = gi.parameters.registration as ContainerRegistration;
                if (reg.input && reg.input.length > 0) {
                    await cacheRestore({ entries: reg.input.map(c => ({ classifier: c })) }).listener(p, gi, e);
                }
            },
        }).withProjectListener({
            name: "cache-put",
            events: [GoalProjectListenerEvent.after],
            listener: async (p, gi, e) => {
                const reg = gi.parameters.registration as ContainerRegistration;
                if (reg.output && reg.output.length > 0) {
                    await cachePut({ entries: reg.output }).listener(p, gi, e);
                }
            },
        });

    }

    public async plan(pli: PushListenerInvocation, goals: Goals): Promise<PlannedGoals> {
        const reg = _.cloneDeep(this.registration);
        const images: Array<{ registry: string, owner: string, repo: string, sha: string, image: string }> = [];
        for (const container of reg.containers.filter(isBuildingContainer)) {
            const git = container.image.slice(GitImagePrefix.length);
            let owner;
            let repo;
            let ref = "master";
            let slug = git;
            if (git.includes("@")) {
                ref = git.split("@")[1];
                slug = git.split("@")[0];
            }
            owner = slug.split("/")[0];
            repo = slug.split("/")[1];

            const api = githubApi((pli.credentials as TokenCredentials).token);
            let sha;
            if (isValidSHA1(ref)) {
                sha = ref;
            } else {
                sha = (await api.repos.listCommits({
                    owner,
                    repo,
                    sha: ref,
                    per_page: 1,
                })).data[0].sha;
            }

            const registry = getRegistryName(pli.configuration.sdm.goal?.docker?.registry) || pli.push.repo.owner.replace(/-/g, "").toLowerCase();
            const url = `https://${registry.includes(".") ? registry : "hub.docker.com"}/v2/repositories/${registry}/${repo}/tags/${sha}`;
            const client = pli.configuration.http.client.factory.create(url);
            const image = `${registry}/${repo}:${sha}`;
            container.image = image;

            try {
                await client.exchange(url, { method: HttpMethod.Get, retry: { retries: 0 } });
            } catch (e) {
                // If we get here the image doesn't yet exist
                images.push({
                    registry,
                    owner,
                    repo,
                    image,
                    sha,
                });
            }
        }
        if (images.length > 0) {
            const imageGoals: PlannedGoal[] = [];
            for (const i of images) {
                const registration: K8sContainerRegistration & DockerContainerRegistration = {
                    containers: [{
                        name: `build-${i.repo}`,
                        image: "gcr.io/kaniko-project/executor:debug",
                        command: [""],
                        args: [
                            "sh",
                            "-c",
                            `wget https://github.com/${i.owner}/${i.repo}/archive/${i.sha}.zip -O /archive.zip && ` +
                            `unzip /archive.zip && ` +
                            `/kaniko/executor --context=dir:///${i.repo}-${i.sha} --destination=${i.image} --dockerfile=Dockerfile --cache=true --cache-repo=${i.registry}/layer-cache`,
                        ],
                        secrets: {
                            fileMounts: [{
                                mountPath: "/kaniko/.docker/config.json",
                                value: {
                                    provider: {
                                        type: "docker",
                                        names: pli.configuration.sdm.goal?.docker?.provider || "atomist-goals",
                                    },
                                },
                            }],
                        },
                        dockerOptions: [`--workdir=/`],
                        workingDir: "/",
                    }],
                };
                imageGoals.push({
                    details: {
                        displayName: `Build ${i.owner}/${i.repo}`,
                    },
                    parameters: {
                        registration,
                    },
                });
            }
            return {
                [`${this.details.displayName}_build`]: {
                    goals: imageGoals,
                },
                [this.details.displayName]: {
                    goals: [{
                        details: {
                            ...this.details,
                        },
                        parameters: {
                            registration: reg,
                        },
                    }],
                    dependsOn: `${this.details.displayName}_build`,
                },
            };
        }
        return {
            [this.details.displayName]:
                {
                    goals: [{
                        details: {
                            ...this.details,
                        },
                        parameters: {
                            registration: reg,
                        },
                    }],
                },
        };
    }
}

function getRegistryName(name: string): string {
    if (!name) {
        return undefined;
    }
    if (name.startsWith("https://")) {
        return name.slice(8);
    } else if (name.startsWith("http://")) {
        return name.slice(7);
    } else {
        return name;
    }
}
