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
import * as gitUrlParse from "git-url-parse";
import * as os from "os";
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
} from "./container";
import {
    DockerContainerRegistration,
    executeDockerJob,
} from "./docker";

export function selfBuildingContainer<T extends ContainerRegistration>(displayName: string, registration: T): SelfBuildingContainer {
    return new SelfBuildingContainer({ displayName }, registration);
}

export class SelfBuildingContainer extends FulfillableGoal {

    public readonly details: ContainerGoalDetails;
    public readonly registration: ContainerRegistration;

    constructor(details: ContainerGoalDetails = {},
                registration: ContainerRegistration,
                ...dependsOn: Goal[]) {
        const prefix = "self-building-container" + (details.displayName ? `-${details.displayName}` : "");
        super(getGoalDefinitionFrom(details, DefaultGoalNameGenerator.generateName(prefix)), ...dependsOn);
        this.details = details;
        this.registration = registration;

        this.addFulfillment({
            progressReporter: ContainerProgressReporter,
            goalExecutor: async gi => {
                const registration = gi.parameters.registration as ContainerRegistration;

                const c = new Container({ displayName: this.definition.displayName });
                (c as any).register = () => {
                };
                (c as any).addFulfillment = () => c;
                (c as any).addFulfillmentCallback = () => c;
                (c as any).withProjectListener = () => c;
                c.with(registration);

                return executeDockerJob(c, registration)(gi);
            },
            name: DefaultGoalNameGenerator.generateName(`self-building-container-docker-${this.definition.displayName}`),
        });

        this.withProjectListener({
            name: "cache-restore",
            events: [GoalProjectListenerEvent.before],
            listener: async (p, gi, e) => {
                const registration = gi.parameters.registration as ContainerRegistration;
                if (registration.input && registration.input.length > 0) {
                    await cacheRestore({ entries: registration.input.map(c => ({ classifier: c })) }).listener(p, gi, e);
                }
            },
        }).withProjectListener({
            name: "cache-put",
            events: [GoalProjectListenerEvent.after],
            listener: async (p, gi, e) => {
                const registration = gi.parameters.registration as ContainerRegistration;
                if (registration.output && registration.output.length > 0) {
                    await cachePut({ entries: registration.output }).listener(p, gi, e);
                }
            },
        });

    }

    public async plan(pli: PushListenerInvocation, goals: Goals): Promise<PlannedGoals> {
        const images: Array<{ registry: string, owner: string, repo: string, gitUrl: string, image: string }> = [];
        for (const c of this.registration.containers.filter((c: any) => !!c.git)) {
            const gitUrl = gitUrlParse((c as any).git);
            const api = githubApi((pli.credentials as TokenCredentials).token);
            const head = await api.repos.listCommits({
                owner: gitUrl.owner,
                repo: gitUrl.name,
                per_page: 1,
            });

            const registry = gitUrl.owner.replace(/-/g, "").toLowerCase();
            const url = `https://hub.docker.com/v2/repositories/${registry}/tags/${head.data[0].sha}`;
            const client = pli.configuration.http.client.factory.create(url);
            const image = `${registry}/${gitUrl.name}:${head.data[0].sha}`;
            c.image = image;

            try {
                await client.exchange(url, { method: HttpMethod.Get, retry: { retries: 0 } });
            } catch (e) {
                // If we get here the image doesn't yet exist
                images.push({
                    registry,
                    owner: gitUrl.owner,
                    repo: gitUrl.name,
                    gitUrl: (c as any).git,
                    image,
                });
            }
        }
        if (images.length > 0) {
            const imageGoals: PlannedGoal[] = [];
            for (const i of images) {
                const registration: DockerContainerRegistration = {
                    containers: [{
                        name: `build-${i.repo}`,
                        image: "gcr.io/kaniko-project/executor",
                        args: [
                            `--context=git://github.com/${i.owner}/${i.repo}.git`,
                            `--destination=${i.image}`,
                            "--dockerfile=Dockerfile",
                            "--cache=true",
                            `--cache-repo=${i.registry}/layer-cache`,
                        ],
                        volumeMounts: [
                            { name: "creds", mountPath: "/kaniko/.docker/config.json" },
                        ],
                        dockerOptions: ["--workdir=/workspace"],
                    }],
                    volumes: [{
                        name: "creds",
                        hostPath: {
                            path: `${os.userInfo().homedir}/.docker/config.json`,
                        }
                    }]
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
                image_build: {
                    goals: imageGoals,
                },
                goals: {
                    goals: [{
                        details: {
                            ...this.details,
                        },
                        parameters: {
                            registration: this.registration,
                        }
                    }],
                    dependsOn: "image_build",
                }
            };
        }
        return undefined;
    }
}
