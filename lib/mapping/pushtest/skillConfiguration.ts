import { hasCommit } from "@atomist/sdm/lib/api-helper/pushtest/commit";
import {
    pushTest,
    PushTest,
} from "@atomist/sdm/lib/api/mapping/PushTest";
import {
    hasFile,
    isBranch,
    ToDefaultBranch,
} from "@atomist/sdm/lib/api/mapping/support/commonPushTests";

const DefaultSkillConfigurationKeys: SkillConfiguredOptions = {
    hasCommit: "hasCommit",
    hasFile: "hasFile",
    isBranch: "isBranch",
    isDefaultBranch: "isDefaultBranch",
};

export interface SkillConfiguredOptions {
    hasCommit?: string;
    hasFile?: string;
    isBranch?: string;
    isDefaultBranch?: string;
}

/**
 * Push test that tests against some well-known pushTests based on skill
 * configuration
 */
export function isSkillConfigured(keys?: SkillConfiguredOptions): PushTest {

    const keysToUse = {
        ...DefaultSkillConfigurationKeys,
        ...keys,
    };

    return pushTest("is skill configured", async pli => {
        const skillConfiguration = {};
        ((pli.context as any)?.trigger?.configuration?.parameters || [])
            .forEach(p => skillConfiguration[p.name] = p.value);

        if (!!skillConfiguration[keysToUse.hasFile]) {
            if (!(await hasFile(skillConfiguration[keysToUse.hasFile]).mapping(pli))) {
                return false;
            }
        }

        if (!!skillConfiguration[keysToUse.isBranch]) {
            const branchRegExp = new RegExp(skillConfiguration[keysToUse.isBranch]);
            if (!(await isBranch(branchRegExp).mapping(pli))) {
                return false;
            }
        }

        if (!!skillConfiguration[keysToUse.isDefaultBranch]) {
            if (!(await ToDefaultBranch.mapping(pli))) {
                return false;
            }
        }

        if (!!skillConfiguration[keysToUse.hasCommit]) {
            const commitRegExp = new RegExp(skillConfiguration[keysToUse.hasCommit]);
            if (!(await hasCommit(commitRegExp).mapping(pli))) {
                return false;
            }
        }

        return true;
    });
}
