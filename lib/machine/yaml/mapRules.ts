import { SoftwareDeliveryMachine } from "@atomist/sdm";
import { toArray } from "../../util/misc/array";
import {
    DeliveryGoals,
    GoalData,
} from "../configure";
import { ConfigureYamlOptions } from "./configureYaml";
import {
    GoalMaker,
    mapGoals,
} from "./mapGoals";
import {
    mapTests,
    PushTestMaker,
} from "./mapPushTests";
import { camelCase } from "./util";

export async function mapRules(rules: any,
                               goalData: GoalData,
                               sdm: SoftwareDeliveryMachine,
                               options: ConfigureYamlOptions<any>,
                               additionalGoals: DeliveryGoals,
                               goalMakers: Record<string, GoalMaker>,
                               testMakers: Record<string, PushTestMaker>): Promise<void> {

    for (const rule of camelCase(toArray(rules))) {
        if (!rule.name) {
            throw new Error(`Property 'name' missing in push rule:\n${JSON.stringify(rule, undefined, 2)}`);
        }
        if (!rule.goals) {
            throw new Error(`Property 'goals' missing in push rule:\n${JSON.stringify(rule, undefined, 2)}`);
        }

        const test = !!rule.tests || !!rule.test ? await mapTests(
            rule.tests || rule.test,
            options.tests || {},
            testMakers) : undefined;

        const goals = await mapGoals(
            sdm,
            rule.goals,
            additionalGoals,
            goalMakers,
            options.tests || {},
            testMakers);
        const dependsOn = rule.dependsOn;

        goalData[rule.name] = {
            test: toArray(test).length > 0 ? test : undefined,
            dependsOn,
            goals,
        };
    }
}
