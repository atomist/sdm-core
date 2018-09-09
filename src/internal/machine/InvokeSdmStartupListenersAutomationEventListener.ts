import { AutomationEventListenerSupport } from "@atomist/automation-client/server/AutomationEventListener";
import { SoftwareDeliveryMachine } from "@atomist/sdm";

/**
 * AutomationEventListener that notifies the SDM StartupListeners that this SDM has been
 * successfully started up
 */
export class InvokeSdmStartupListenersAutomationEventListener extends AutomationEventListenerSupport {

    constructor(private readonly sdm: SoftwareDeliveryMachine) {
        super();
    }

    public startupSuccessful(): Promise<any> {
        if ((this.sdm as any).notifyStartupListeners) {
            return (this.sdm as any).notifyStartupListeners();
        }
    }
}
