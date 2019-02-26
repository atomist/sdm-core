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
