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
import { SoftwareDeliveryMachine } from "@atomist/sdm/lib/api/machine/SoftwareDeliveryMachine";
import { CommandHandlerRegistration } from "@atomist/sdm/lib/api/registration/CommandHandlerRegistration";
import { ParameterStyle } from "@atomist/sdm/lib/api/registration/CommandRegistration";
import { ParametersObject } from "@atomist/sdm/lib/api/registration/ParametersDefinition";
import * as _ from "lodash";
import {
    OAuthToken,
    RepositoryByOwnerAndNameQuery,
    RepositoryByOwnerAndNameQueryVariables,
    RepositoryMappedChannels,
    RepositoryMappedChannelsQuery,
    RepositoryMappedChannelsQueryVariables,
    ResourceUserQuery,
    ResourceUserQueryVariables,
} from "../../typings/types";
import {
    CreateGoals,
    DeliveryGoals,
} from "../configure";
import {
    CommandMaker,
    YamlCommandHandlerRegistration,
} from "./configureYaml";
import Repos = RepositoryMappedChannels.Repos;

export function decorateSoftwareDeliveryMachine<G extends DeliveryGoals>(sdm: SoftwareDeliveryMachine & { createGoals: CreateGoals<G> })
    : SoftwareDeliveryMachine & { createGoals: CreateGoals<G> } {
    const proxy = new Proxy<SoftwareDeliveryMachine & { createGoals: CreateGoals<G> }>(sdm, {
        get: (target, propKey) => {
            if (propKey === "addCommand") {
                return (...args) => {
                    const cmd = args[0] as CommandHandlerRegistration;
                    target[propKey]({
                        name: cmd.name,
                        ...mapCommand(cmd)(sdm) as YamlCommandHandlerRegistration,
                    });
                };
            } else {
                return target[propKey];
            }
        },
    });
    return proxy;
}

export function mapCommand(chr: CommandHandlerRegistration): CommandMaker {
    return sdm => {
        const ch = commandHandlerRegistrationToCommand(sdm, chr);
        const metadata = metadataFromInstance(toFactory(ch)()) as CommandHandlerMetadata;
        const parameterNames = metadata.parameters.filter(p => p.displayable === undefined || !!p.displayable).map(p => p.name);

        const mapIntent = (intents: string[]) => {
            if (!!intents && intents.length > 0) {
                if (parameterNames.length > 0) {
                    return `^(?:${intents.map(i => i.replace(/ /g, "\\s+")).join("|")})(?:\\s+--(?:${parameterNames.join("|")})=(?:'[^']*?'|"[^"]*?"|[\\w]*?))*$`;
                } else {
                    return `^(?:${intents.map(i => i.replace(/ /g, "\\s+")).join("|")})$`;
                }
            } else {
                return undefined;
            }
        };

        return {

            name: metadata.name,
            description: metadata.description,
            intent: mapIntent(metadata.intent || []),
            tags: (metadata.tags || []).map(t => t.name),

            listener: async ci => {
                const instance = toFactory(ch)();
                const parameterDefinition: ParametersObject<any> = {};

                const intent = ((ci.context as any).trigger).raw_message;
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

                const parameters = await ci.promptFor(parameterDefinition, {
                    autoSubmit: metadata.auto_submit,
                    parameterStyle: ParameterStyle.Dialog[metadata.question],
                });
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
                const credential: OAuthToken = _.get(resourceUser, "ChatId[0].person.gitHubId.credential");
                if (!!credential) {
                    const uriParts = secret.uri.split("?scopes=");
                    if (uriParts.length === 2) {
                        // Check for scopes
                        const scopes = uriParts[1].split(",");
                        if (scopes.some(scope => !credential.scopes.includes(scope))) {
                            // TODO cd send redirect to scope increase page
                            await ci.addressChannels(slackErrorMessage(
                                "Missing GitHub OAuth Scope",
                                "The recorded token is missing some requested scopes",
                                ci.context));
                        }
                    }
                    const s = credential.secret;
                    _.update(parameters, secret.name, () => s);
                }
            } else {
                // TODO cd send redirect to oauth token collection page
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
            switch (mp.uri) {
                case MappedParameters.GitHubOwner:
                case MappedParameters.GitHubOwnerWithUser:
                    const ownerDetails = await loadRepositoryDetailsFromChannel(ci);
                    _.update(parameters, mp.name, () => ownerDetails.owner);
                    break;
                case MappedParameters.GitHubRepository:
                case MappedParameters.GitHubAllRepositories:
                    const repoDetails = await loadRepositoryDetailsFromChannel(ci);
                    _.update(parameters, mp.name, () => repoDetails.name);
                    break;
                case MappedParameters.GitHubApiUrl:
                    const apiUrlDetails = await loadRepositoryDetailsFromChannel(ci);
                    _.update(parameters, mp.name, () => apiUrlDetails.apiUrl);
                    break;
                case MappedParameters.GitHubRepositoryProvider:
                    const providerIdDetails = await loadRepositoryDetailsFromChannel(ci);
                    _.update(parameters, mp.name, () => providerIdDetails.providerId);
                    break;
                case MappedParameters.GitHubUrl:
                    const urlDetails = await loadRepositoryDetailsFromChannel(ci);
                    _.update(parameters, mp.name, () => urlDetails.url);
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
    const channels = await ci.context.graphClient.query<RepositoryMappedChannelsQuery, RepositoryMappedChannelsQueryVariables>({
        name: "RepositoryMappedChannels",
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
            }, {});
            const repo = repos.find(r => r.id === parameters.repo_id);
            return {
                name: repo.name,
                owner: repo.owner,
                providerId: repo.org.provider.providerId,
                providerType: repo.org.provider.providerType,
                apiUrl: repo.org.provider.apiUrl,
                url: repo.org.provider.url,
            };
        } else {
            const parameters = await ci.promptFor<{ repo_slug: string }>({
                repo_slug: {
                    displayName: "Repository (owner/repository)",
                },
            }, {});
            const repo = await ci.context.graphClient.query<RepositoryByOwnerAndNameQuery, RepositoryByOwnerAndNameQueryVariables>({
                name: "RepositoryByOwnerAndName",
                variables: {
                    owner: parameters.repo_slug.split("/")[0],
                    name: parameters.repo_slug.split("/")[1],
                },
            });
            return {
                name: repo?.Repo[0]?.name,
                owner: repo?.Repo[0]?.owner,
                providerId: repo?.Repo[0]?.org.provider.providerId,
                providerType: repo?.Repo[0]?.org.provider.providerType,
                apiUrl: repo?.Repo[0]?.org.provider.apiUrl,
                url: repo?.Repo[0]?.org.provider.url,
            };
        }
    }
    return {};
}
