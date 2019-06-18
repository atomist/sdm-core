import {
    ExtensionPack,
    metadata,
} from "@atomist/sdm";
import { executeTask } from "./executeTask";
import { JobResponseEnablingAutomationEventListener } from "./JobResponseEnablingAutomationEventListener";

export function jobSupport(): ExtensionPack {
    return {
        ...metadata("job"),
        configure: sdm => {
            sdm.addEvent(executeTask(sdm));
            sdm.configuration.listeners = [
                ...(sdm.configuration.listeners || []),
                new JobResponseEnablingAutomationEventListener(),
            ];
        },
    };
}
