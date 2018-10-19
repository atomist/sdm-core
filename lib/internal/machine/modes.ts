import { PushTest } from "@atomist/sdm";

/**
 * Is this SDM in local mode?
 * Invoked on client startup.
 */
export function isInLocalMode(): boolean {
    return process.env.ATOMIST_MODE === "local";
}

/**
 * Is this SDM running in local mode?
 */
export const IsInLocalMode: PushTest = {
    name: "IsInLocalMode",
    mapping: async () => isInLocalMode(),
};

/**
 * Is this SDM running as a GitHub action?
 * Invoked on client startup.
 */
export function isGitHubAction(): boolean {
    return !!process.env.GITHUB_WORKFLOW && !!process.env.GITHUB_ACTION && !!process.env.GITHUB_WORKSPACE;
}

/**
 * Is this SDM running as a GitHub action?
 */
export const IsGitHubAction: PushTest = {
    name: "IsGitHubAction",
    mapping: async () => isGitHubAction(),
};