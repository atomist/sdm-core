/*
 * Copyright © 2019 Atomist, Inc.
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
    doWithRetry,
    GitHubRepoRef,
    logger,
    ProjectOperationCredentials,
    RemoteRepoRef,
} from "@atomist/automation-client";
import {
    ArtifactStore,
    DeployableArtifact,
    toToken,
} from "@atomist/sdm";
import { AppInfo } from "@atomist/sdm/lib/spi/deploy/Deployment";
import * as GitHubApi from "@octokit/rest";
// tslint:disable-next-line:import-blacklist
import axios from "axios";
import * as fs from "fs-extra";
import * as p from "path";
import * as tmp from "tmp-promise";
import * as URL from "url";
import {
    createRelease,
    createTag,
    Release,
    Tag,
} from "../../../util/github/ghub";

/* tslint:disable:deprecation */

/**
 * Implement ArtifactStore interface to store artifacts as GitHub releases
 * @deprecated Artifact storage should be done using project listeners
 */
export class GitHubReleaseArtifactStore implements ArtifactStore {

    public async storeFile(appInfo: AppInfo, localFile: string, creds: ProjectOperationCredentials): Promise<string> {
        const token = toToken(creds);
        const tagName = appInfo.version + new Date().getMilliseconds();
        const tag: Tag = {
            tag: tagName,
            message: appInfo.version + " for release",
            object: appInfo.id.sha,
            type: "commit",
            tagger: {
                name: "Atomist",
                email: "info@atomist.com",
                date: new Date().toISOString(),
            },
        };
        const grr = appInfo.id as GitHubRepoRef;
        await createTag(token, grr, tag);
        const release: Release = {
            name: appInfo.version,
            tag_name: tag.tag,
        };
        await createRelease(token, grr, release);
        const asset = await uploadAsset(token, grr.owner, grr.repo, tag.tag, localFile);
        logger.info("Uploaded artifact with url [%s] for %j", asset.browser_download_url, appInfo);
        return asset.browser_download_url;
    }

    // TODO this is Maven specific
    // Name is of format fintan-0.1.0-SNAPSHOT.jar
    public async checkout(url: string, id: RemoteRepoRef, creds: ProjectOperationCredentials): Promise<DeployableArtifact> {
        logger.info("Attempting to download artifact [%s] for %j", url, id);
        const tmpDir = await tmp.dir({ prefix: "GitHubReleaseArtifactStore-", unsafeCleanup: true });
        const cwd = tmpDir.path;
        const lastSlash = url.lastIndexOf("/");
        const filename = url.substring(lastSlash + 1);
        const re = /([a-zA-Z0-9_]+)-(.*)/;
        const match = re.exec(filename);
        const name = match[1];
        const version = match[2].replace(/.jar$/, "");

        const outputPath = cwd + "/" + filename;
        logger.info("Attempting to download url %s to %s", url, outputPath);
        await downloadFileAs(creds, url, outputPath);
        logger.info("Successfully downloaded url %s to %s", url, outputPath);
        return {
            cwd,
            filename,
            name,
            version,
            id,
        };
    }
}

/**
 * Download the file to local disk. This only works on public repos, see
 * https://stackoverflow.com/questions/20396329/how-to-download-github-release-from-private-repo-using-command-line
 * @param creds ignored
 * @param {string} url release asset URL from public repo
 * @param {string} outputFilename
 * @return {Promise<any>}
 */
function downloadFileAs(creds: ProjectOperationCredentials, url: string, outputFilename: string): Promise<any> {
    return doWithRetry(() => axios.get(url, {
        headers: { Accept: "application/octet-stream" },
        responseType: "arraybuffer",
    }), `Download ${url} to ${outputFilename}`, {
            minTimeout: 1000,
            maxTimeout: 10000,
            retries: 10,
        })
        .then(result => {
            return fs.writeFile(outputFilename, result.data);
        });
}

export interface Asset {
    url: string;
    browser_download_url: string;
    name: string;
}

export async function uploadAsset(token: string,
                                  owner: string,
                                  repo: string,
                                  tag: string,
                                  path: string,
                                  contentType: string = "application/zip"): Promise<Asset> {
    const github = githubApi(token);
    const result = await github.repos.getReleaseByTag({ owner, repo, tag });
    const file = (await fs.readFile(path)).buffer;
    const contentLength = (await fs.stat(path)).size;
    const r = await github.repos.uploadReleaseAsset({
        url: result.data.upload_url,
        file,
        headers: {
            "content-length": contentLength,
            "content-type": contentType,
        },
        name: p.basename(path),
    });
    return r.data as any;
}

export function githubApi(token: string, apiUrl: string = "https://api.github.com/"): GitHubApi {
    // separate the url
    const url = URL.parse(apiUrl);

    const gitHubApi = new GitHubApi({
        host: url.hostname,
        protocol: url.protocol.slice(0, -1),
        port: +url.port,
    });

    gitHubApi.authenticate({ type: "token", token });
    return gitHubApi;
}
