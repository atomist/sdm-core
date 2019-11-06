import { loadUserConfiguration } from "@atomist/automation-client/lib/configuration";
import * as crypto from "crypto";

async function decrypt(data: string) {
    const cfg = await loadUserConfiguration();
    const encryptionCfp = cfg.sdm.encryption;
    if (!encryptionCfp) {
        throw new Error("Encryption configuration missing to encrypt secret");
    }
    const encrypt = crypto.publicEncrypt(encryptionCfp.publicKey, Buffer.from(data, "utf8"));
    console.log(encrypt.toString("base64"));
}

decrypt(process.argv[2]);
