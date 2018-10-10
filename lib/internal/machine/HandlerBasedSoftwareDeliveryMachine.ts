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
    Configuration,
    Maker,
} from "@atomist/automation-client";
import { HandleCommand } from "@atomist/automation-client/lib/HandleCommand";
import { HandleEvent } from "@atomist/automation-client/lib/HandleEvent";
import {
    AbstractSoftwareDeliveryMachine,
    FunctionalUnit,
    GoalSetter,
    SoftwareDeliveryMachineConfiguration,
} from "@atomist/sdm";
import * as _ from "lodash";
import { InvokeListenersOnBuildComplete } from "../../handlers/events/delivery/build/InvokeListenersOnBuildComplete";
import { ReactToSemanticDiffsOnPushImpact } from "../../handlers/events/delivery/code/ReactToSemanticDiffsOnPushImpact";
import { FulfillGoalOnRequested } from "../../handlers/events/delivery/goals/FulfillGoalOnRequested";
import { RequestDownstreamGoalsOnGoalSuccess } from "../../handlers/events/delivery/goals/RequestDownstreamGoalsOnGoalSuccess";
import { RespondOnGoalCompletion } from "../../handlers/events/delivery/goals/RespondOnGoalCompletion";
import { SetGoalsOnPush } from "../../handlers/events/delivery/goals/SetGoalsOnPush";
import { SkipDownstreamGoalsOnGoalFailure } from "../../handlers/events/delivery/goals/SkipDownstreamGoalsOnGoalFailure";
import { VoteOnGoalApprovalRequest } from "../../handlers/events/delivery/goals/VoteOnGoalApprovalRequest";
import { ClosedIssueHandler } from "../../handlers/events/issue/ClosedIssueHandler";
import { NewIssueHandler } from "../../handlers/events/issue/NewIssueHandler";
import { UpdatedIssueHandler } from "../../handlers/events/issue/UpdatedIssueHandler";
import { OnChannelLink } from "../../handlers/events/repo/OnChannelLink";
import { OnFirstPushToRepo } from "../../handlers/events/repo/OnFirstPushToRepo";
import { OnPullRequest } from "../../handlers/events/repo/OnPullRequest";
import { OnRepoCreation } from "../../handlers/events/repo/OnRepoCreation";
import { OnRepoOnboarded } from "../../handlers/events/repo/OnRepoOnboarded";
import { OnTag } from "../../handlers/events/repo/OnTag";
import { OnUserJoiningChannel } from "../../handlers/events/repo/OnUserJoiningChannel";
import { SendFingerprintToAtomist } from "../../util/webhook/sendFingerprintToAtomist";

/**
 * Implementation of SoftwareDeliveryMachine based on Atomist event handlers.
 * Not intended for direct user instantiation. See machineFactory.ts
 */
export class HandlerBasedSoftwareDeliveryMachine extends AbstractSoftwareDeliveryMachine {

    private get onRepoCreation(): Maker<OnRepoCreation> {
        return this.repoCreationListeners.length > 0 ?
            () => new OnRepoCreation(
                this.repoCreationListeners,
                this.configuration.sdm.repoRefResolver,
                this.configuration.sdm.credentialsResolver) :
            undefined;
    }

    private get onFirstPush(): Maker<OnFirstPushToRepo> {
        return this.firstPushListeners.length > 0 ?
            () => new OnFirstPushToRepo(
                this.firstPushListeners,
                this.configuration.sdm.repoRefResolver,
                this.configuration.sdm.credentialsResolver) :
            undefined;
    }

    private get semanticDiffReactor(): Maker<ReactToSemanticDiffsOnPushImpact> {
        return this.fingerprintDifferenceListeners.length > 0 ?
            () => new ReactToSemanticDiffsOnPushImpact(
                this.fingerprintDifferenceListeners,
                this.configuration.sdm.repoRefResolver,
                this.configuration.sdm.credentialsResolver) :
            undefined;
    }

    private get goalSetting(): FunctionalUnit {
        if (this.pushMapping) {
            return {
                eventHandlers: [() => new SetGoalsOnPush(
                    this.configuration.sdm.projectLoader,
                    this.configuration.sdm.repoRefResolver,
                    this.pushMapping,
                    this.goalsSetListeners,
                    this.goalFulfillmentMapper,
                    this.configuration.sdm.credentialsResolver)],
                commandHandlers: [],
                ingesters: [],
            };
        } else {
            return {
                eventHandlers: [],
                commandHandlers: [],
                ingesters: [],
            };
        }
    }

    private get goalConsequences(): FunctionalUnit {
        if (this.pushMapping) {
            return {
                eventHandlers: [
                    () => new SkipDownstreamGoalsOnGoalFailure(this.configuration.sdm.repoRefResolver),
                    () => new RequestDownstreamGoalsOnGoalSuccess(
                        this.configuration.name,
                        this.goalFulfillmentMapper,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver),
                    () => new RespondOnGoalCompletion(
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver,
                        this.goalCompletionListeners),
                    () => new VoteOnGoalApprovalRequest(
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver,
                        this.goalApprovalRequestVoters,
                        this.goalFulfillmentMapper)],
                commandHandlers: [],
                ingesters: [],
            };
        } else {
            return {
                eventHandlers: [],
                commandHandlers: [],
                ingesters: [],
            };
        }
    }

    private get allFunctionalUnits(): FunctionalUnit[] {
        return []
            .concat([
                this.goalSetting,
                this.goalConsequences,
            ]);
    }

    get eventHandlers(): Array<Maker<HandleEvent<any>>> {
        return this.registrationManager.eventHandlers
            .concat(this.pushMapping ? () => new FulfillGoalOnRequested(
                this.goalFulfillmentMapper,
                this.goalExecutionListeners) : undefined)
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.eventHandlers)))
            .concat([
                this.userJoiningChannelListeners.length > 0 ?
                    () => new OnUserJoiningChannel(
                        this.userJoiningChannelListeners,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.buildListeners.length > 0 ?
                    () => new InvokeListenersOnBuildComplete(
                        this.buildListeners,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.tagListeners.length > 0 ?
                    () => new OnTag(
                        this.tagListeners,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.newIssueListeners.length > 0 ?
                    () => new NewIssueHandler(
                        this.newIssueListeners,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.updatedIssueListeners.length > 0 ?
                    () => new UpdatedIssueHandler(
                        this.updatedIssueListeners,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.closedIssueListeners.length > 0 ?
                    () => new ClosedIssueHandler(
                        this.closedIssueListeners,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.channelLinkListeners.length > 0 ?
                    () => new OnChannelLink(
                        this.configuration.sdm.projectLoader,
                        this.configuration.sdm.repoRefResolver,
                        this.channelLinkListeners,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.pullRequestListeners.length > 0 ?
                    () => new OnPullRequest(
                        this.configuration.sdm.projectLoader,
                        this.configuration.sdm.repoRefResolver,
                        this.pullRequestListeners,
                        this.configuration.sdm.credentialsResolver) : undefined,
                this.repoOnboardingListeners.length > 0 ?
                    () => new OnRepoOnboarded(
                        this.repoOnboardingListeners,
                        this.configuration.sdm.repoRefResolver,
                        this.configuration.sdm.credentialsResolver) :
                    undefined,
                this.onRepoCreation,
                this.onFirstPush,
                this.semanticDiffReactor,
            ])
            .filter(m => !!m);
    }

    get commandHandlers(): Array<Maker<HandleCommand>> {
        return this.registrationManager.commandHandlers
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.commandHandlers)))
            .filter(m => !!m);
    }

    get ingesters(): string[] {
        return this.registrationManager.ingesters
            .concat(_.flatten(this.allFunctionalUnits.map(fu => fu.ingesters)))
            .filter(m => !!m);
    }

    /**
     * Construct a new software delivery machine, with zero or
     * more goal setters.
     * @param {string} name
     * @param configuration automation client configuration we're running in
     * @param {GoalSetter} goalSetters tell me what to do on a push. Hint: start with "whenPushSatisfies(...)"
     */
    constructor(name: string,
                configuration: Configuration & SoftwareDeliveryMachineConfiguration,
                goalSetters: Array<GoalSetter | GoalSetter[]>) {
        super(name, configuration, goalSetters);
        // This hits the Atomist service
        this.addFingerprintListener(SendFingerprintToAtomist);
    }

}
