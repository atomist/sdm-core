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

import { metadata } from "@atomist/sdm/api-helper/misc/extensionPack";
import { ExtensionPack } from "@atomist/sdm/api/machine/ExtensionPack";
import { selfDescribeHandler } from "./SelfDescribe";

/**
 * Expose information about this machine
 */
export const ExposeInfo: ExtensionPack = {
    ...metadata("info"),
    configure: sdm => {
        sdm.addCommand(selfDescribeHandler(sdm));
    },
};
