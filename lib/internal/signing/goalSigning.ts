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
    AutomationEventListenerSupport,
    CustomEventDestination,
    Destination,
    EventFired,
    HandlerContext,
    logger,
    MessageOptions,
} from "@atomist/automation-client";
import {
    GoalSigningKey,
    GoalVerificationKey,
    SdmGoalEvent,
    SdmGoalMessage,
    SdmGoalState,
    SdmProvenance,
    updateGoal,
} from "@atomist/sdm";
import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { isGoalRelevant } from "../delivery/goals/support/validateGoal";

export interface SignatureMixin {
    signature: string;
}

/**
 * AutomationEventListener that verifies incoming SDM goals against a set of configurable
 * verification public keys.
 *
 * Optionally a private key can be specified to sign outgoing goals. Setting this is strongly
 * recommended to prevent executing untrusted and/or tampered SDM goals.
 */
export class GoalSigningAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly verificationKeys: GoalVerificationKey[] = [],
                private readonly signingKey?: GoalSigningKey) {
        super();
        this.initVerificationKeys();
    }

    public async eventStarting(payload: EventFired<any>, ctx: HandlerContext): Promise<void> {
        if (this.verificationKeys.length === 0) {
            return;
        }

        const goal = _.get(payload, "data.SdmGoal[0]") as SdmGoalEvent & SignatureMixin;

        if (!!goal && isGoalRelevant(goal) && !isGoalRejected(goal)) {
            if (!!goal.signature) {
                const verifier = crypto.createVerify("RSA-SHA512");
                verifier.update(normalizeGoal(goal));
                verifier.end();

                const message = Buffer.from(goal.signature, "base64");
                const verifiedWith = this.verificationKeys.find(vk => verifier.verify(vk.publicKey, message));
                if (!!verifiedWith) {
                    logger.info(
                        `Verified signature for incoming goal '${goal.uniqueName}' of '${goal.goalSetId}' with key '${verifiedWith.name}'`);
                } else {
                    await rejectGoal("signature invalid", goal, ctx);
                    throw new Error("SDM goal signature invalid. Rejecting goal!");
                }
            } else {
                await rejectGoal("signature missing", goal, ctx);
                throw new Error("SDM goal signature is missing. Rejecting goal!");
            }
        }
    }

    public async messageSending(message: any,
                                destinations: Destination | Destination[],
                                options: MessageOptions,
                                ctx: HandlerContext): Promise<any> {
        const dests = Array.isArray(destinations) ? destinations : [destinations];

        if (!!this.signingKey &&
            dests.some(d => d.userAgent === "ingester" && (d as CustomEventDestination).rootType === "SdmGoal")) {

            const goal = signGoal(message as SdmGoalMessage & SignatureMixin, this.signingKey);
            logger.info(`Signed outgoing goal '${goal.uniqueName}' of '${goal.goalSetId}'`);
            return goal;
        }

        return message;
    }

    private initVerificationKeys(): void {
        // Load the Atomist public key
        const publicKey = fs.readFileSync(path.join(__dirname, "atomist-public.pem")).toString();
        this.verificationKeys.push({ publicKey, name: "atomist.com" });

        // If signing key is set, also use it to verify
        if (!!this.signingKey) {
            this.verificationKeys.push(this.signingKey);
        }
    }
}

export function signGoal(goal: SdmGoalMessage & SignatureMixin,
                         signingKey: GoalSigningKey): SdmGoalMessage {
    const signer = crypto.createSign("RSA-SHA512");
    signer.update(normalizeGoal(goal));
    signer.end();

    const signature = signer.sign({ key: signingKey.privateKey, passphrase: signingKey.passphrase });
    goal.signature = signature.toString("base64");

    return goal;
}

export async function rejectGoal(phase: string,
                                 sdmGoal: SdmGoalEvent,
                                 ctx: HandlerContext): Promise<void> {
    await updateGoal(
        ctx,
        sdmGoal,
        {
            state: SdmGoalState.failure,
            description: `Rejected: ${sdmGoal.name}`,
            phase,
        });
}

export function isGoalRejected(sdmGoal: SdmGoalEvent): boolean {
    return sdmGoal.state === SdmGoalState.failure && sdmGoal.description === `Rejected: ${sdmGoal.name}`;
}

export function normalizeGoal(goal: SdmGoalMessage | SdmGoalEvent): string {
    return `uniqueName:${goal.uniqueName}
        environment:${goal.environment}
        goalSetId:${goal.goalSetId}
        state:${goal.state}
        ts:${goal.ts}
        version:${goal.version}
        repo:${goal.repo.owner}/${goal.repo.name}/${goal.repo.providerId}
        sha:${goal.sha}
        branch:${goal.branch}
        fulfillment:${goal.fulfillment.name}-${goal.fulfillment.method}
        preConditions:${(goal.preConditions || []).map(p => `${p.environment}/${p.uniqueName}`)}
        data:${normalizeValue(goal.data)}
        url:${normalizeValue(goal.url)}
        externalUrls:${(goal.externalUrls || []).map(u => u.url).join(",")}
        provenance:${(goal.provenance || []).map(normalizeProvenance).join(",")}
        retry:${normalizeValue(goal.retryFeasible)}
        approvalRequired:${normalizeValue(goal.approvalRequired)}
        approval:${normalizeProvenance(goal.approval)}
        preApprovalRequired:${normalizeValue(goal.preApprovalRequired)}
        preApproval:${normalizeProvenance(goal.preApproval)}`;
}

function normalizeProvenance(p: SdmProvenance): string {
    if (!!p) {
        return `${normalizeValue(p.registration)}:${normalizeValue(p.version)}/${normalizeValue(p.name)}-${
            normalizeValue(p.userId)}-${normalizeValue(p.channelId)}-${p.ts}`;
    } else {
        return "undefined";
    }
}

function normalizeValue(value: any): string {
    if (!!value) {
        return value.toString();
    } else {
        return "undefined";
    }
}
