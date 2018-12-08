/*
 * Copyright © 2018 Atomist, Inc.
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
    automationClientInstance,
    AutomationEventListenerSupport,
    EventIncoming,
    guid,
    logger,
    QueryNoCacheOptions,
    RequestProcessor,
    Secrets,
} from "@atomist/automation-client";
import { ApolloGraphClient } from "@atomist/automation-client/lib/graph/ApolloGraphClient";
import { metadataFromInstance } from "@atomist/automation-client/lib/internal/metadata/metadataReading";
import { RegistrationConfirmation } from "@atomist/automation-client/lib/internal/transport/websocket/WebSocketRequestProcessor";
import { SoftwareDeliveryMachine } from "@atomist/sdm";
import * as cluster from "cluster";
import * as _ from "lodash";
import { SdmGoalById } from "../../../../typings/types";
import { FulfillGoalOnRequested } from "./FulfillGoalOnRequested";

export class GoalAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        super();
    }

    public eventIncoming(payload: EventIncoming) {
        if (cluster.isWorker) {
            // Register event handler locally only
            const maker = () => new FulfillGoalOnRequested(
                this.sdm.goalFulfillmentMapper,
                [...this.sdm.goalExecutionListeners]);
            automationClientInstance().withEventHandler(maker);
        }
    }

    public async registrationSuccessful(eventHandler: RequestProcessor) {
        if (cluster.isMaster) {
            const registration = (eventHandler as any).registration as RegistrationConfirmation;
            const teamId = process.env.ATOMIST_GOAL_TEAM;
            const teamName = process.env.ATOMIST_GOAL_TEAM_NAME || teamId;
            const goalId = process.env.ATOMIST_GOAL_ID;
            const correlationId = process.env.ATOMIST_CORRELATION_ID || guid();

            // Obtain goal via graphql query
            const graphClient = new ApolloGraphClient(
                `${this.sdm.configuration.endpoints.graphql}/${teamId}`,
                { Authorization: `Bearer ${registration.jwt}` });

            const goal = await graphClient.query<SdmGoalById.Query, SdmGoalById.Variables>({
                name: "SdmGoalById",
                variables: {
                    id: goalId,
                },
                options: QueryNoCacheOptions,
            });

            // Register event handler locally only
            const maker = () => new FulfillGoalOnRequested(
                this.sdm.goalFulfillmentMapper,
                [...this.sdm.goalExecutionListeners]);
            automationClientInstance().withEventHandler(maker);

            // Create event and run event handler
            const event: EventIncoming = {
                data: _.cloneDeep(goal),
                extensions: {
                    correlation_id: correlationId,
                    team_id: teamId,
                    team_name: teamName,
                    operationName: metadataFromInstance(maker()).name,
                },
                secrets: [{
                    uri: Secrets.OrgToken,
                    value: "null",
                }],
            };
            await eventHandler.processEvent(event, async results => {
                const resolved = await results;
                logger.info("Processing goal completed with results %j", resolved);
                setTimeout(() => process.exit(0), 10000);
            });
        }
    }
}
