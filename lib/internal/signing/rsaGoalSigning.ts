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
    GoalSigningAlgorithm,
    GoalSigningKey,
    GoalVerificationKey,
} from "@atomist/sdm";
import * as crypto from "crypto";

/**
 * RSA based GoalSigningAlgorithm
 */
export const RsaGoalSigningAlgorithm: GoalSigningAlgorithm<string> = {

    sign: async (goal: string, key: GoalSigningKey<string>) => {
        const signer = crypto.createSign("RSA-SHA512");
        signer.update(goal);
        signer.end();

        const signature = signer.sign({
            key: key.privateKey,
            passphrase: key.passphrase,
        });

        return signature.toString("base64");
    },

    verify: async (goal: string, signatureString: string, keys: Array<GoalVerificationKey<string>>) => {
        const signature = Buffer.from(signatureString, "base64");
        return keys.find(vk => {
            const verifier = crypto.createVerify("RSA-SHA512");
            verifier.update(goal);
            verifier.end();
            return verifier.verify(vk.publicKey, signature);
        });
    },
};
