import { possibleAxiosObjectReplacer } from "@atomist/automation-client/internal/transport/AbstractRequestProcessor";
import * as stringify from "json-stringify-safe";
import * as _ from "lodash";

export function serializeResult(result: any): string {
    const safeResult = _.omit(result, "childProcess");
    return stringify(safeResult, possibleAxiosObjectReplacer, 0);
}
