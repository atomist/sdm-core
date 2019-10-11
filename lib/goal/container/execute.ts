import { resolvePlaceholders } from "@atomist/automation-client/lib/configuration";
import {
    DefaultGoalNameGenerator,
    doWithProject,
    goal,
    GoalWithFulfillment,
} from "@atomist/sdm";
import * as fs from "fs-extra";
import * as _ from "lodash";
import { resolvePlaceholder } from "../../machine/yaml/mapGoals";
import {
    ContainerProgressReporter,
    ContainerSecrets,
} from "./container";
import { prepareSecrets } from "./provider";

export interface ExecuteRegistration {
    cmd: string;
    args: string | string[];
    secrets?: ContainerSecrets;
}

export function execute(name: string,
                        registration: ExecuteRegistration): GoalWithFulfillment {
    const uniqueName = name.replace(/ /g, "-");
    const executeGoal = goal(
        { displayName: name, uniqueName: DefaultGoalNameGenerator.generateName(uniqueName) },
        doWithProject(async gi => {
            // Resolve placeholders
            const registrationToUse = _.cloneDeep(registration);
            await resolvePlaceholders(
                registrationToUse,
                value => resolvePlaceholder(value, undefined, {} as any, {}));

            // Mount the secrets
            let secrets;
            const secretEnvs = {};
            if (!!registrationToUse.secrets) {
                secrets = await prepareSecrets({ secrets: registrationToUse.secrets }, gi);
                secrets.env.forEach(e => secretEnvs[e.name] = e.value);
                for (const f of secrets.files) {
                    await fs.writeFile(f.mountPath, f.value);
                }
            }

            try {
                return gi.spawn(
                    registrationToUse.cmd,
                    registrationToUse.args,
                    { env: { ...process.env, ...secretEnvs } });
            } finally {
                // Cleanup secrets;
                if (!!secrets) {
                    for (const f of secrets.files) {
                        await fs.unlink(f.mountPath);
                    }
                }
            }
        }, {
            readOnly: false,
            detachHead: true,
        }), { progressReporter: ContainerProgressReporter });
    return executeGoal;
}
