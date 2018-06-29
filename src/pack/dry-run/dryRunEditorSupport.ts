/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { subscription } from "@atomist/automation-client/graph/graphQL";
import { metadata } from "@atomist/sdm/api-helper/misc/extensionPack";
import { ExtensionPack } from "@atomist/sdm/api/machine/ExtensionPack";
import {
    onDryRunBuildComplete,
    OnDryRunBuildCompleteParameters,
} from "./support/OnDryRunBuildComplete";

/**
 * Core extension pack to add dry run editing support. It's necessary to add this pack
 * to have dry run editorCommand function respond to builds.
 */
export const DryRunEditing: ExtensionPack = {
    ...metadata("dry-run-editing"),
    configure: sdm => {
        sdm.addEvent({
            name: "OnDryRunBuildComplete",
            description: "React to result of a dry run build",
            subscription: subscription("OnBuildCompleteForDryRun"),
            paramsMaker: OnDryRunBuildCompleteParameters,
            listener: onDryRunBuildComplete(sdm.configuration.sdm.repoRefResolver),
        });
    },
};
