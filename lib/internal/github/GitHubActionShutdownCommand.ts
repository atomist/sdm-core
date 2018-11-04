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

import {
    configurationValue,
    NoParameters,
} from "@atomist/automation-client";
import { HandleCommand } from "@atomist/automation-client/lib/HandleCommand";
import { commandHandlerFrom } from "@atomist/automation-client/lib/onCommand";
import {
    slackWarningMessage,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import axios from "axios";
import * as fs from "fs-extra";
import * as path from "path";

export function gitHubActionShutdownCommand(machine: SoftwareDeliveryMachine): HandleCommand<NoParameters> {
    return commandHandlerFrom(
        async ctx => {

            const log = (await fs.readFile(path.join(".", "log", "sdm.log"))).toString();
            const gist: any = {
                description: `SDM log file - ${configurationValue<string>("name")}`,
                public: false,
                files: {
                    "sdm.log": {
                        content: log,
                    },
                },
            };

            const response = await axios.post(
                "https://api.github.com/gists",
                gist,
                { headers: { Authorization: `token ${configurationValue<string>("token")}` } });

            await ctx.messageClient.respond(
                slackWarningMessage(
                    "SDM Shutdown",
                    `Triggering shutdown of _${machine.configuration.name}_

Uploaded log to GitHub Gist at: ${response.data.html_url}`,
                    ctx,
                    {
                        footer: `${machine.configuration.name}:${machine.configuration.version}`,
                    }));
            setInterval(() => process.exit(1), 2500);
        },
        NoParameters,
        "GitHubActionShutdown",
        "Shutdown the running SDM",
        [`shutdown ${machine.configuration.name.replace("@", "")}`]);
}
