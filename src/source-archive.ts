// Copyright 2026 Daniil Antoshin
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export const maxArchiveBytes = 32 * 1024 * 1024;
// Leave room for base64 and the message envelope within Chromium's IPC limit.
export const maxGoArchiveBytes = 45 * 1024 * 1024;

export function githubDiffLocation(url: Pick<URL, "protocol" | "host" | "pathname">) {
  if (url.protocol !== "https:") return null;
  if (url.host === "github.com") {
    const commit = /^\/([\w.-]+)\/([\w.-]+)\/commit\/([a-f\d]{40})\.(?:diff|patch)$/i.exec(url.pathname);
    if (commit) return { owner: commit[1], repo: commit[2], ref: commit[3].toLowerCase(), commit: true };
  }
  const path = url.host === "github.com" ? url.pathname :
    url.host === "patch-diff.githubusercontent.com" && url.pathname.startsWith("/raw/") ? url.pathname.slice(4) : "";
  const pull = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\.(?:diff|patch)$/.exec(path);
  return pull ? { owner: pull[1], repo: pull[2], ref: pull[3], commit: false } : null;
}

export function archiveLocation(sender: string, source: unknown, revision: string) {
  const url = new URL(sender);
  const suffix = "\\.(?:diff|patch)$";
  if (url.protocol !== "https:") throw new Error("Repository indexing requires HTTPS");
  if (url.hostname === "github.com" || url.hostname === "patch-diff.githubusercontent.com") {
    const match = githubDiffLocation(url);
    if (!match || (match.commit && match.ref !== revision)) throw new Error("Open a GitHub diff at the revision to index");
    const repository = `${match.owner}/${match.repo}`;
    const project = !match.commit && typeof source === "string" && /^[\w.-]+\/[\w.-]+$/.test(source) ? source : repository;
    if (project.split("/").some((segment) => segment === ".." || segment === ".")) throw new Error("Invalid source repository");
    return {
      repository: `https://github.com/${repository}`, sourceProject: project,
      archive: `https://api.github.com/repos/${project}/tarball/${revision}`,
      tokenHost: "github.com",
      tokenHeader: "Authorization",
    };
  }
  const match = new RegExp(`^/(.+)/-/merge_requests/\\d+${suffix}`).exec(url.pathname);
  if (!match) throw new Error("Open a GitLab merge request diff to index it");
  const project = typeof source === "string" && /^\d+$/.test(source) ? source : encodeURIComponent(decodeURIComponent(match[1]));
  return {
    repository: `${url.origin}/${match[1]}`, sourceProject: project,
    archive: `${url.origin}/api/v4/projects/${project}/repository/archive.tar.gz?sha=${revision}&include_lfs_blobs=false`,
    tokenHost: url.host,
    tokenHeader: "PRIVATE-TOKEN",
  };
}

export async function loadArchive(response: Response, maximum = maxArchiveBytes) {
  if (!response.ok || !response.body) {
    const requestId = response.headers.get("X-Request-Id");
    throw new Error(`Source archive request failed (HTTP ${response.status})${requestId ? `, request ${requestId}` : ""}`);
  }
  const parts: Uint8Array[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new Error(`Source archive exceeds ${maximum / (1024 * 1024)} MiB`);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const archive = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    archive.set(part, offset);
    offset += part.length;
  }
  return archive;
}

export async function loadGitLabArchive(archive: string, headers: Record<string, string>, maximum = maxArchiveBytes) {
  // GitLab rejects archive requests with Sec-Fetch-Mode: cors.
  return loadArchive(await fetch(archive, {
    headers: { ...headers, Accept: "application/octet-stream" },
    mode: "same-origin",
    credentials: "same-origin",
    redirect: "error",
  }), maximum);
}
