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
    addressEvent,
    ChildProcessResult,
    configurationValue,
    failure,
    HandlerContext,
    HandlerResult,
    logger,
    RemoteRepoRef,
    Success,
} from "@atomist/automation-client";
import {
    AddressChannels,
    AppInfo,
    ArtifactStore,
    Builder,
    InterpretLog,
    ProgressLog,
    ProjectOperationCredentials,
    PushThatTriggersBuild,
    QueryNoCacheOptions,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import { sprintf } from "sprintf-js";
import { SdmBuildIdentifierForRepo } from "../../../../typings/types";
import { postLinkImageWebhook } from "../../../../util/webhook/ImageLink";
import { isInLocalMode } from "../../../machine/LocalSoftwareDeliveryMachineOptions";
import { createTagForStatus } from "../executeTag";
import { AtomistBuildStatusUpdater } from "./AtomistBuildStatusUpdater";
import { readSdmVersion } from "./projectVersioner";
import SdmBuildIdentifier = SdmBuildIdentifierForRepo.SdmBuildIdentifier;

/**
 * Implemented by types than can update build status
 */
export interface BuildStatusUpdater {

    updateBuildStatus(runningBuild: { repoRef: RemoteRepoRef, url: string, team: string },
                      status: "started" | "failed" | "error" | "passed" | "canceled",
                      branch: string,
                      buildNo: string,
                      ctx: HandlerContext): Promise<any>;
}

function isBuildStatusUpdater(a: object): a is BuildStatusUpdater {
    const maybe = a as BuildStatusUpdater;
    return !!maybe.updateBuildStatus;
}

/**
 * @ModuleExport
 */
export interface LocalBuildInProgress {

    readonly buildResult: Promise<ChildProcessResult>;

    readonly repoRef: RemoteRepoRef;

    readonly team: string;

    /** Available once build is complete */
    readonly appInfo: AppInfo;

    readonly deploymentUnitFile: string;

    readonly url: string;
}

/**
 * Superclass for build implemented on the automation client itself, emitting appropriate events to Atomist.
 * Allows listening to a Running build
 * @ModuleExport
 */
export abstract class LocalBuilder implements Builder {

    protected constructor(public readonly name: string,
                          protected readonly sdm: SoftwareDeliveryMachine) {
    }

    private get buildStatusUpdater(): BuildStatusUpdater {
        return isBuildStatusUpdater(this.sdm) ?
            this.sdm :
            new AtomistBuildStatusUpdater();
    }

    public async initiateBuild(credentials: ProjectOperationCredentials,
                               id: RemoteRepoRef,
                               addressChannels: AddressChannels,
                               push: PushThatTriggersBuild,
                               log: ProgressLog,
                               context: HandlerContext): Promise<HandlerResult> {
        const as = this.sdm.configuration.sdm.artifactStore;
        const atomistTeam = context.workspaceId;
        const buildNumber = await this.obtainBuildIdentifier(push, context);

        try {
            const rb = await this.startBuild(credentials, id, atomistTeam, log, addressChannels);
            await this.onStarted(credentials, id, push, rb, buildNumber, context);
            try {
                const br = await rb.buildResult;
                log.write(`Build result: ${br.error ? "Error" : "Success"}${br.message ? " " + br.message : ""}`);
                await this.onExit(
                    credentials,
                    id,
                    !br.error,
                    push,
                    rb,
                    buildNumber,
                    as,
                    context);
                return br.error ? { code: 1, message: br.message } : Success;
            } catch (err) {
                logger.warn("Build on branch %s failed on run: %j - %s", push.branch, id, err.message);
                log.write(sprintf("Build failed with: %s", err.message));
                log.write(err.stack);
                await this.onExit(
                    credentials,
                    id,
                    false,
                    push,
                    rb,
                    buildNumber,
                    as,
                    context);
                return failure(err);
            }
        } catch (err) {
            // If we get here, the build failed before even starting
            logger.warn("Build on branch %s failed on start: %j - %s", push.branch, id, err.message);
            log.write(sprintf("Build on branch %s failed on start: %j - %s", push.branch, id, err.message));
            await this.buildStatusUpdater.updateBuildStatus({ repoRef: id, team: atomistTeam, url: undefined },
                "failed",
                push.branch,
                buildNumber,
                context);
            return failure(err);
        }
    }

    /**
     * Implemented to interpret build logs
     * @param {string} log
     * @return {InterpretedLog}
     */
    public abstract logInterpreter: InterpretLog;

    protected abstract startBuild(credentials: ProjectOperationCredentials,
                                  id: RemoteRepoRef,
                                  atomistTeam: string,
                                  log: ProgressLog,
                                  addressChannels: AddressChannels): Promise<LocalBuildInProgress>;

    protected onStarted(credentials: ProjectOperationCredentials,
                        id: RemoteRepoRef,
                        push: PushThatTriggersBuild,
                        runningBuild: LocalBuildInProgress,
                        buildNo: string,
                        context: HandlerContext) {
        return this.buildStatusUpdater.updateBuildStatus(runningBuild, "started", push.branch, buildNo, context);
    }

    protected async onExit(credentials: ProjectOperationCredentials,
                           id: RemoteRepoRef,
                           success: boolean,
                           push: PushThatTriggersBuild,
                           runningBuild: LocalBuildInProgress,
                           buildNo: string,
                           artifactStore: ArtifactStore,
                           context: HandlerContext): Promise<any> {
        try {
            if (success) {
                await this.buildStatusUpdater.updateBuildStatus(runningBuild, "passed", push.branch, buildNo, context);
                await this.createBuildTag(id, push, buildNo, context, credentials);
                if (!!runningBuild.deploymentUnitFile) {
                    await linkArtifact(credentials, runningBuild, context.workspaceId, artifactStore);
                } else {
                    logger.warn("No artifact generated by build of %j", runningBuild.appInfo);
                }
            } else {
                await this.buildStatusUpdater.updateBuildStatus(runningBuild, "failed", push.branch, buildNo, context);
            }
        } catch (err) {
            logger.warn("Unexpected build exit error: %s", err);
        }
    }

    protected async obtainBuildIdentifier(push: PushThatTriggersBuild,
                                          ctx: HandlerContext): Promise<string> {
        const result = await ctx.graphClient.query<SdmBuildIdentifierForRepo.Query, SdmBuildIdentifierForRepo.Variables>({
            name: "SdmBuildIdentifierForRepo",
            variables: {
                owner: [push.owner],
                name: [push.name],
                providerId: [push.providerId],
            },
            options: QueryNoCacheOptions,
        });

        let buildIdentifier: SdmBuildIdentifier;
        if (result.SdmBuildIdentifier && result.SdmBuildIdentifier.length === 1) {
            buildIdentifier = result.SdmBuildIdentifier[0];
        } else {
            buildIdentifier = {
                identifier: "0",
                repo: {
                    owner: push.owner,
                    name: push.name,
                    providerId: push.providerId,
                },
            };
        }

        const bumpedBuildIdentifier = {
            ...buildIdentifier,
            identifier: (+buildIdentifier.identifier + 1).toString(),
        };
        await ctx.messageClient.send(bumpedBuildIdentifier, addressEvent("SdmBuildIdentifier"));
        return bumpedBuildIdentifier.identifier;
    }

    protected async createBuildTag(id: RemoteRepoRef,
                                   push: PushThatTriggersBuild,
                                   buildNo: string,
                                   context: HandlerContext,
                                   credentials: ProjectOperationCredentials) {
        if (configurationValue<boolean>("sdm.build.tag", true) && !isInLocalMode()) {
            const version = await readSdmVersion(push.owner, push.name, push.providerId, push.sha, id.branch, context);
            if (version) {
                await createTagForStatus(
                    id,
                    push.sha,
                    "Tag created by SDM",
                    `${version}+sdm.${buildNo}`,
                    credentials);
            }
        }
    }
}

function linkArtifact(creds: ProjectOperationCredentials, rb: LocalBuildInProgress, team: string, artifactStore: ArtifactStore): Promise<any> {
    return artifactStore.storeFile(rb.appInfo, rb.deploymentUnitFile, creds)
        .then(imageUrl => postLinkImageWebhook(rb.repoRef.owner, rb.repoRef.repo, rb.repoRef.sha, imageUrl, team));
}
