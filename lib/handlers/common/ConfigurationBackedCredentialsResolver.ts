import {
    configurationValue,
    HandlerContext,
    Parameters,
    ProjectOperationCredentials,
    RemoteRepoRef,
} from "@atomist/automation-client";
import { CredentialsResolver } from "@atomist/sdm";

/**
 * Resolves to single credentials from the configuration
 */
@Parameters()
export class ConfigurationBackedCredentialsResolver implements CredentialsResolver {

    constructor(private readonly paths: { username: string, password: string } = {
        username: "sdm.git.user",
        password: "sdm.git.password",
    }) {
        const creds = this.credentialsFromConfiguration();
        if (!creds.username) {
            throw new Error(`Git username missing at '${paths.username}'`);
        }
        if (!creds.password) {
            throw new Error(`Git password missing at '${paths.password}'`);
        }
    }

    public eventHandlerCredentials(context: HandlerContext): ProjectOperationCredentials {
        return this.credentialsFromConfiguration();
    }

    public commandHandlerCredentials(context: HandlerContext, id: RemoteRepoRef): ProjectOperationCredentials {
        throw this.credentialsFromConfiguration();
    }

    private credentialsFromConfiguration(): ProjectOperationCredentials & { username: string, password: string} {
        return {
            username: configurationValue<string>(this.paths.username),
            password: configurationValue<string>(this.paths.password),
        };
    }
}
