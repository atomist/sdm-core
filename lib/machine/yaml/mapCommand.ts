/*
 * Copyright © 2020 Atomist, Inc.
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
    MappedParameters,
    Secrets,
} from "@atomist/automation-client/lib/decorators";
import { Failure } from "@atomist/automation-client/lib/HandlerResult";
import { metadataFromInstance } from "@atomist/automation-client/lib/internal/metadata/metadataReading";
import {
    populateParameters,
    populateValues,
} from "@atomist/automation-client/lib/internal/parameterPopulation";
import { CommandIncoming } from "@atomist/automation-client/lib/internal/transport/RequestProcessor";
import { CommandHandlerMetadata } from "@atomist/automation-client/lib/metadata/automationMetadata";
import { toFactory } from "@atomist/automation-client/lib/util/constructionUtils";
import { commandHandlerRegistrationToCommand } from "@atomist/sdm/lib/api-helper/machine/handlerRegistrations";
import { slackErrorMessage } from "@atomist/sdm/lib/api-helper/misc/slack/messages";
import { CommandListenerInvocation } from "@atomist/sdm/lib/api/listener/CommandListener";
import { CommandHandlerRegistration } from "@atomist/sdm/lib/api/registration/CommandHandlerRegistration";
import { ParametersObject } from "@atomist/sdm/lib/api/registration/ParametersDefinition";
import * as _ from "lodash";
import {
    GitHubUserTokenQuery,
    GitHubUserTokenQueryVariables,
    MappedChannels,
    MappedChannelsQuery,
    MappedChannelsQueryVariables,
    ResourceUserQuery,
    ResourceUserQueryVariables,
} from "../../typings/types";
import { toArray } from "../../util/misc/array";
import { CommandMaker } from "./configureYaml";
import Repos = MappedChannels.Repos;

export function mapCommand(chr: CommandHandlerRegistration): CommandMaker {
    return sdm => {
        const ch = commandHandlerRegistrationToCommand(sdm, chr);
        const metadata = metadataFromInstance(toFactory(ch)()) as CommandHandlerMetadata;
        const parameterNames = metadata.parameters.map(p => p.name);

        const mapIntent = (intent: string) => {
            if (parameterNames.length > 0) {
                return `^${intent}(\\s--(?:${parameterNames.join("|")})=(?:["'\\s\\S]*))*$`;
            } else {
                return `^${intent}$`;
            }
        };

        return {

            name: metadata.name,
            description: metadata.description,
            intent: toArray(metadata.intent).map(mapIntent),
            tags: (metadata.tags || []).map(t => t.name),

            listener: async ci => {
                const instance = toFactory(ch)();
                const parameterDefinition: ParametersObject<any> = {};

                const intent = ((ci.context as any).trigger as any).raw_message;
                if (!!intent) {
                    const args = require("yargs-parser")(intent);
                    ((ci.context as any).trigger as CommandIncoming).parameters.push(..._.map(args, (v, k) => ({
                        name: k,
                        value: v,
                    })));
                }

                metadata.parameters.forEach(p => {
                    parameterDefinition[p.name] = {
                        ...p,
                        pattern: !!p.pattern ? new RegExp(p.pattern) : undefined,
                    };
                });

                const parameters = await ci.promptFor(parameterDefinition);
                populateParameters(instance, metadata, _.map(parameters, (v, k) => ({ name: k, value: v as any })));
                populateValues(instance, metadata, ci.configuration);
                await populateSecrets(parameters, metadata, ci);
                const missing = await populateMappedParameters(parameters, metadata, ci);
                if (missing.length > 0) {
                    await ci.addressChannels(slackErrorMessage("Missing Mapped Parameters", missing.join("\n"), ci.context));
                    return Failure;
                }
                return instance.handle(ci.context, parameters);
            },
        };
    };
}

async function populateSecrets(parameters: any, metadata: CommandHandlerMetadata, ci: CommandListenerInvocation): Promise<void> {
    for (const secret of (metadata.secrets || [])) {
        if (secret.uri.startsWith(Secrets.UserToken)) {
            const chatId = _.get(ci, "context.trigger.source.slack.user.id");
            if (!!chatId) {
                const resourceUser = await ci.context.graphClient.query<ResourceUserQuery, ResourceUserQueryVariables>({
                    name: "ResourceUser",
                    variables: {
                        id: chatId,
                    },
                });
                // TODO cd properly support different providers
                const credentialId = _.get(resourceUser, "ChatId[0].person.resourceUsers[0].credential.id");
                if (!!credentialId) {
                    const credential = await ci.context.graphClient.query<GitHubUserTokenQuery, GitHubUserTokenQueryVariables>({
                        name: "GitHubUserToken",
                        variables: {
                            id: credentialId,
                        },
                    });
                    const s = _.get(credential, "OAuthToken[0].secret");
                    _.update(parameters, secret.name, () => s);
                }
            }
        } else if (secret.uri === Secrets.OrgToken) {
            // TODO cd add this
        }
    }
}

async function populateMappedParameters(parameters: any, metadata: CommandHandlerMetadata, ci: CommandListenerInvocation): Promise<string[]> {
    const missing = [];
    for (const mp of (metadata.mapped_parameters || [])) {
        const value = ((ci.context as any).trigger as CommandIncoming).parameters.find(p => p.name === mp.name);
        if (value !== undefined) {
            _.update(parameters, mp.name, () => value.value);
        } else {
            const repo = await loadRepositoryDetailsFromChannel(ci);
            switch (mp.uri) {
                case MappedParameters.GitHubOwner:
                case MappedParameters.GitHubOwnerWithUser:
                    _.update(parameters, mp.name, () => repo.owner);
                    break;
                case MappedParameters.GitHubRepository:
                    _.update(parameters, mp.name, () => repo.name);
                    break;
                case MappedParameters.GitHubApiUrl:
                    _.update(parameters, mp.name, () => repo.apiUrl);
                    break;
                case MappedParameters.GitHubRepositoryProvider:
                    _.update(parameters, mp.name, () => repo.providerId);
                    break;
                case MappedParameters.GitHubUrl:
                    _.update(parameters, mp.name, () => repo.url);
                    break;

                case MappedParameters.GitHubUserLogin:
                    const chatId = _.get(ci, "context.trigger.source.slack.user.id");
                    const resourceUser = await ci.context.graphClient.query<ResourceUserQuery, ResourceUserQueryVariables>({
                        name: "ResourceUser",
                        variables: {
                            id: chatId,
                        },
                    });
                    _.update(parameters, mp.name, () => _.get(resourceUser, "ChatId[0].person.gitHubId.login"));
                    break;
                case MappedParameters.SlackChannel:
                    _.update(parameters, mp.name, () => _.get(ci, "context.trigger.source.slack.channel.id"));
                    break;
                case MappedParameters.SlackChannelName:
                    _.update(parameters, mp.name, () => _.get(ci, "context.trigger.source.slack.channel.name"));
                    break;
                case MappedParameters.SlackUser:
                    _.update(parameters, mp.name, () => _.get(ci, "context.trigger.source.slack.user.id"));
                    break;
                case MappedParameters.SlackUserName:
                    _.update(parameters, mp.name, () => _.get(ci, "context.trigger.source.slack.user.name"));
                    break;
                case MappedParameters.SlackTeam:
                    _.update(parameters, mp.name, () => _.get(ci, "context.trigger.source.slack.team.id"));
                    break;
            }
        }

        if (parameters[mp.name] === undefined && mp.required === true) {
            missing.push(`Required mapped parameter '${mp.name}' missing`);
        }
    }
    return missing;
}

async function loadRepositoryDetailsFromChannel(ci: CommandListenerInvocation)
    : Promise<{ name?: string, owner?: string, providerId?: string, providerType?: string, apiUrl?: string, url?: string }> {
    const channelId = _.get(ci, "context.trigger.source.slack.channel.id");
    const channels = await ci.context.graphClient.query<MappedChannelsQuery, MappedChannelsQueryVariables>({
        name: "MappedChannels",
        variables: {
            id: channelId,
        },
    });
    const repos: Repos[] = _.get(channels, "ChatChannel[0].repos") || [];
    if (!!repos) {
        if (repos.length === 1) {
            return {
                name: repos[0].name,
                owner: repos[0].owner,
                providerId: repos[0].org.provider.providerId,
                providerType: repos[0].org.provider.providerType,
                apiUrl: repos[0].org.provider.apiUrl,
                url: repos[0].org.provider.url,
            };
        } else if (repos.length > 0) {
            const parameters = await ci.promptFor<{ repo_id: string }>({
                repo_id: {
                    displayName: "Repository",
                    type: {
                        kind: "single",
                        options: repos.map(r => ({ description: `${r.owner}/${r.name}`, value: r.id })),
                    },
                },
            });
            const repo = repos.find(r => r.id === parameters.repo_id);
            return {
                name: repo.name,
                owner: repo.owner,
                providerId: repo.org.provider.providerId,
                providerType: repo.org.provider.providerType,
                apiUrl: repo.org.provider.apiUrl,
                url: repo.org.provider.url,
            };
        }
    }
    return {};
}
