import {
    GitHubRepoRef,
    Secrets,
    TokenCredentials,
} from "@atomist/automation-client";
import * as assert from "power-assert";
import { GitHubCredentialsResolver } from "../../../lib/handlers/common/GitHubCredentialsResolver";

describe("GitHubCredentialsResolver", () => {

    beforeEach(() => {
        delete (global as any).__runningAutomationClient;
    });

    afterEach(() => {
        delete (global as any).__runningAutomationClient;
    });

    describe("eventHandlerCredentials", () => {

        it("should resolve from configuration", async () => {
            const sr = new GitHubCredentialsResolver();

            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {
                        github: {
                            token: "123456",
                        },
                    },
                },
            };

            const creds = await sr.eventHandlerCredentials({
                    trigger: {
                        secrets: [{ uri: Secrets.OrgToken, value: "654321" }],
                    },
                    graphClient: {
                        query: () => {
                            assert.fail();
                        },
                    },
                } as any,
                GitHubRepoRef.from({ owner: "atomist", repo: "sdm" }));

            assert.strictEqual((creds as TokenCredentials).token, "123456");
        });

        it("should resolve from incoming event", async () => {
            const sr = new GitHubCredentialsResolver();

            const creds = await sr.eventHandlerCredentials({
                    trigger: {
                        secrets: [{ uri: Secrets.OrgToken, value: "654321" }],
                    },
                    graphClient: {
                        query: () => {
                            assert.fail();
                        },
                    },
                } as any,
                GitHubRepoRef.from({ owner: "atomist", repo: "sdm" }));

            assert.strictEqual((creds as TokenCredentials).token, "654321");
        });

        it("should resolve from scm provider", async () => {
            const sr = new GitHubCredentialsResolver();

            const creds = await sr.eventHandlerCredentials({
                    trigger: {},
                    graphClient: {
                        query: () => {
                            return {
                                SCMProvider: [{
                                    credential: {
                                        secret: "654321",
                                    },
                                }],
                            };
                        },
                    },
                } as any,
                GitHubRepoRef.from({ owner: "atomist", repo: "sdm" }));

            assert.strictEqual((creds as TokenCredentials).token, "654321");
        });

        it("should throw error if no token", async () => {
            const sr = new GitHubCredentialsResolver();

            try {
                await sr.eventHandlerCredentials(
                    {
                        graphClient: {
                            query: () => {
                                return { SCMProvider: [] };
                            },
                        },
                    } as any,
                    GitHubRepoRef.from({
                        owner: "atomist",
                        repo: "sdm",
                    }));
            } catch (e) {
                assert(e.message.includes("No GitHub token available!"));
            }

        });

    });

    describe("commandHandlerCredentials", () => {

        it("should resolve from configuration", async () => {
            const sr = new GitHubCredentialsResolver();

            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {
                        github: {
                            token: "123456",
                        },
                    },
                },
            };

            const creds = await sr.commandHandlerCredentials({
                    trigger: {},
                    graphClient: {
                        query: () => {
                            assert.fail();
                        },
                    },
                } as any,
                GitHubRepoRef.from({ owner: "atomist", repo: "sdm" }));

            assert.strictEqual((creds as TokenCredentials).token, "123456");
        });

        it("should resolve from incoming command", async () => {
            const sr = new GitHubCredentialsResolver();

            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {
                        github: {
                            token: "123456",
                        },
                    },
                },
            };

            const creds = await sr.commandHandlerCredentials({
                    trigger: {
                        secrets: [{ uri: Secrets.OrgToken, value: "654321" }],
                    },
                    graphClient: {
                        query: () => {
                            assert.fail();
                        },
                    },
                } as any,
                GitHubRepoRef.from({ owner: "atomist", repo: "sdm" }));

            assert.strictEqual((creds as TokenCredentials).token, "654321");
        });

        it("should resolve from scm provider", async () => {
            const sr = new GitHubCredentialsResolver();

            const creds = await sr.commandHandlerCredentials({
                    trigger: {},
                    graphClient: {
                        query: () => {
                            return {
                                SCMProvider: [{
                                    credential: {
                                        secret: "654321",
                                    },
                                }],
                            };
                        },
                    },
                } as any,
                GitHubRepoRef.from({ owner: "atomist", repo: "sdm" }));

            assert.strictEqual((creds as TokenCredentials).token, "654321");
        });

        it("should throw error if no token", async () => {
            const sr = new GitHubCredentialsResolver();

            try {
                await sr.commandHandlerCredentials(
                    {
                        graphClient: {
                            query: () => {
                                return { SCMProvider: [] };
                            },
                        },
                    } as any,
                    GitHubRepoRef.from({
                        owner: "atomist",
                        repo: "sdm",
                    }));
            } catch (e) {
                assert(e.message.includes("No GitHub token available!"));
            }

        });

    });

})
;
