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
    AutomationClient,
    AutomationEventListenerSupport,
    EventIncoming,
    guid,
    logger,
    Maker,
    QueryNoCacheOptions,
    safeExit,
    Secrets,
} from "@atomist/automation-client";
import { ApolloGraphClient } from "@atomist/automation-client/lib/graph/ApolloGraphClient";
import { HandleCommand } from "@atomist/automation-client/lib/HandleCommand";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    isCommandHandlerMetadata,
    isEventHandlerMetadata,
} from "@atomist/automation-client/lib/internal/metadata/metadata";
import { metadataFromInstance } from "@atomist/automation-client/lib/internal/metadata/metadataReading";
import { AutomationMetadata } from "@atomist/automation-client/lib/metadata/automationMetadata";
import { AutomationMetadataProcessor } from "@atomist/automation-client/lib/spi/env/MetadataProcessor";
import { toFactory } from "@atomist/automation-client/lib/util/constructionUtils";
import { SoftwareDeliveryMachine } from "@atomist/sdm";
import * as cluster from "cluster";
import * as _ from "lodash";
import { SdmGoalsByGoalSetIdAndUniqueName } from "../../../../typings/types";
import { FulfillGoalOnRequested } from "./FulfillGoalOnRequested";

export class GoalAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        super();
    }

    public async startupSuccessful(client: AutomationClient): Promise<void> {
        if (cluster.isMaster) {
            const teamId = process.env.ATOMIST_GOAL_TEAM;
            const teamName = process.env.ATOMIST_GOAL_TEAM_NAME || teamId;
            const goalSetId = [process.env.ATOMIST_GOAL_SET_ID];
            const uniqueName = [process.env.ATOMIST_GOAL_UNIQUE_NAME];
            const correlationId = process.env.ATOMIST_CORRELATION_ID || guid();

            // Obtain goal via graphql query
            const graphClient = new ApolloGraphClient(
                `${this.sdm.configuration.endpoints.graphql}/${teamId}`,
                { Authorization: `Bearer ${client.configuration.apiKey}` });

            const goal = await graphClient.query<SdmGoalsByGoalSetIdAndUniqueName.Query, SdmGoalsByGoalSetIdAndUniqueName.Variables>({
                name: "SdmGoalsByGoalSetIdAndUniqueName",
                variables: {
                    goalSetId,
                    uniqueName,
                },
                options: QueryNoCacheOptions,
            });

            // Create event and run event handler
            const event: EventIncoming = {
                data: _.cloneDeep(goal),
                extensions: {
                    correlation_id: correlationId,
                    team_id: teamId,
                    team_name: teamName,
                    operationName: metadataFromInstance(new FulfillGoalOnRequested(
                        this.sdm.goalFulfillmentMapper,
                        [...this.sdm.goalExecutionListeners])).name,
                },
                secrets: [{
                    uri: Secrets.OrgToken,
                    value: "null",
                }],
            };
            try {
                await new Promise<void>((resolve, reject) => {
                    client.processEvent(event, pResults => {
                        pResults.then(results => {
                            logger.debug("Processing goal completed with results %j", results);
                            resolve();
                        }, reject);
                    });
                });
            } catch (e) {
                logger.error(`Processing goal failed: ${e.message}`);
            }
            // Exit successfully to avoid job schedulers retrying.
            safeExit(0);
        }
    }
}

export class FilteringMetadataProcessor implements AutomationMetadataProcessor {

    private readonly allowedCommands: string[];
    private readonly allowedEvents: string[];

    constructor(allowedCommandHandlers: Array<Maker<HandleCommand<any>>>,
                allowedEventHandlers: Array<Maker<HandleEvent<any>>>) {
        this.allowedCommands = allowedCommandHandlers.map(h => metadataFromInstance(toFactory(h)()).name);
        this.allowedEvents = allowedEventHandlers.map(h => metadataFromInstance(toFactory(h)()).name);
    }

    public process<T extends AutomationMetadata>(metadata: T): T {
        if (isEventHandlerMetadata(metadata) && !this.allowedEvents.includes(metadata.name)) {
            metadata.expose = false;
        } else if (isCommandHandlerMetadata(metadata) && !this.allowedCommands.includes(metadata.name)) {
            metadata.expose = false;
        }
        return metadata;
    }
}
