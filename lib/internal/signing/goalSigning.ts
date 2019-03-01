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
    AutomationEventListenerSupport,
    CustomEventDestination,
    Destination,
    HandlerContext,
    logger,
    MessageOptions,
} from "@atomist/automation-client";
import {
    GoalSigningAlgorithm,
    GoalSigningConfiguration,
    GoalSigningKey,
    GoalSigningScope,
    GoalVerificationKey,
    SdmGoalEvent,
    SdmGoalMessage,
    SdmGoalState,
    SdmProvenance,
    updateGoal,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as path from "path";
import { DeepPartial } from "ts-essentials";
import { toArray } from "../../util/misc/array";
import { RsaGoalSigningAlgorithm } from "./rsaGoalSigning";

export interface SignatureMixin {
    signature: string;
}

export const DefaultGoalSigningAlgorithm = RsaGoalSigningAlgorithm;

/**
 * AutomationEventListener that verifies incoming SDM goals against a set of configurable
 * verification public keys.
 *
 * Optionally a private key can be specified to sign outgoing goals. Setting this is strongly
 * recommended to prevent executing untrusted and/or tampered SDM goals.
 */
export class GoalSigningAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly gsc: GoalSigningConfiguration) {
        super();
        this.initVerificationKeys();
    }

    public async messageSending(message: any,
                                destinations: Destination | Destination[],
                                options: MessageOptions,
                                ctx: HandlerContext): Promise<any> {
        const dests = Array.isArray(destinations) ? destinations : [destinations];

        if (dests.some(d => d.userAgent === "ingester" && (d as CustomEventDestination).rootType === "SdmGoal")) {
            return signGoal(message as SdmGoalMessage & SignatureMixin, this.gsc);
        }

        return message;
    }

    private initVerificationKeys(): void {
        this.gsc.verificationKeys = toArray(this.gsc.verificationKeys);

        // If signing key is set, also use it to verify
        if (!!this.gsc.signingKey) {
            this.gsc.verificationKeys.push(this.gsc.signingKey);
        }

        // Load the Atomist public key
        const publicKey = fs.readFileSync(path.join(__dirname, "atomist-public.pem")).toString();
        this.gsc.verificationKeys.push({ publicKey, name: "atomist.com/sdm" });
    }
}

/**
 * Verify a goal signature against the public keys configured in provided Configuration.
 * If signature can't be verified, the goal will be marked as failed and an Error will be thrown.
 * @param goal goal to verify
 * @param gsc signing configuration
 * @param ctx
 */
export async function verifyGoal(goal: SdmGoalEvent & DeepPartial<SignatureMixin>,
                                 gsc: GoalSigningConfiguration,
                                 ctx: HandlerContext): Promise<void> {
    if (!!gsc && gsc.enabled === true && !!goal && isInScope(gsc.scope, ctx) && !isGoalRejected(goal)) {
        if (!!goal.signature) {

            const message = normalizeGoal(goal);

            let verifiedWith: GoalVerificationKey<any>;
            for (const key of toArray(gsc.verificationKeys)) {
                if (await findAlgorithm(key, gsc).verify(message, goal.signature, key)) {
                    verifiedWith = key;
                    break;
                }
            }

            if (!!verifiedWith) {
                logger.info(
                    `Verified signature for incoming goal '${goal.uniqueName}' of '${goal.goalSetId}' with key '${
                        verifiedWith.name}' and algorithm '${verifiedWith.algorithm}'`);
            } else {
                await rejectGoal("signature was invalid", goal, ctx);
                throw new Error("SDM goal signature invalid. Rejecting goal!");
            }

        } else {
            await rejectGoal("signature was missing", goal, ctx);
            throw new Error("SDM goal signature is missing. Rejecting goal!");
        }
    }
}

/**
 * Add a signature to a goal
 * @param goal
 * @param gsc
 */
export async function signGoal(goal: SdmGoalMessage,
                               gsc: GoalSigningConfiguration): Promise<SdmGoalMessage & SignatureMixin> {
    if (!!gsc && gsc.enabled === true && !!gsc.signingKey) {
        (goal as any).signature = await findAlgorithm(gsc.signingKey, gsc).sign(normalizeGoal(goal), gsc.signingKey);
        logger.info(`Signed goal '${goal.uniqueName}' of '${goal.goalSetId}'`);
        return goal as any;
    } else {
        return goal as any;
    }
}

async function rejectGoal(reason: string,
                          sdmGoal: SdmGoalEvent,
                          ctx: HandlerContext): Promise<void> {
    await updateGoal(
        ctx,
        sdmGoal,
        {
            state: SdmGoalState.failure,
            description: `Rejected ${sdmGoal.name} because ${reason}`,
        });
}

function findAlgorithm(key: GoalVerificationKey<any> | GoalSigningKey<any>,
                       gsc: GoalSigningConfiguration): GoalSigningAlgorithm<any> {
    const algorithm = [...toArray(gsc.algorithms || []), DefaultGoalSigningAlgorithm]
        .find(a => a.name.toLowerCase() === (key.algorithm || DefaultGoalSigningAlgorithm.name).toLowerCase());
    if (!algorithm) {
        throw new Error(
            `Goal signing or verification key '${key.name}' requested algorithm '${key.algorithm}' which isn't configured`);
    }
    return algorithm;
}

function isInScope(scope: GoalSigningScope, ctx: HandlerContext): boolean {
    if (scope === GoalSigningScope.All) {
        return true;
    } else if (scope === GoalSigningScope.Fulfillment &&
        (ctx as any as AutomationContextAware).context.operation === "FulfillGoalOnRequested") {
        return true;
    } else {
        return false;
    }
}

function isGoalRejected(sdmGoal: SdmGoalEvent): boolean {
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
        preConditions:${(goal.preConditions || []).map(p => `${
        p.environment}/${normalizeValue(p.name)}/${normalizeValue(p.uniqueName)}`)}
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
