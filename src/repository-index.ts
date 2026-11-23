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

import { credentialFor } from "./providers/shared";
import { refreshOAuthToken } from "./oauth";
import { archiveLocation, loadArchive, maxArchiveBytes } from "./source-archive";
import { runIndex, type IndexPayload } from "./index-runner";

declare const PATCHTREE_INDEX_VERSION: string;
const pending = new Map<string, Promise<IndexPayload | null>>();
const downloads = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const cacheName = "patchtree-index-v4";
const archiveCacheName = "patchtree-source-v1";
const expiresHeader = "X-Patchtree-Expires";
const encodingHeader = "X-Patchtree-Index-Encoding";
const day = 24 * 60 * 60 * 1000;
let cacheReady: Promise<[Cache, Cache] | null> | undefined;
let nextSweep = 0;
let archiveWrites = Promise.resolve();

function expires(response: Response) {
  return Number(response.headers.get(expiresHeader));
}

async function getEntry(cache: Cache | undefined, key: string) {
  const entry = await cache?.match(key).catch(() => undefined);
  return entry && expires(entry) > Date.now() ? entry : undefined;
}

function indexCaches() {
  if (cacheReady && Date.now() < nextSweep) return cacheReady;
  nextSweep = Date.now() + day;
  cacheReady = (async () => {
    const indexes = await caches.open(cacheName);
    const archives = await caches.open(archiveCacheName);
    for (const cache of [indexes, archives]) {
      for (const key of await cache.keys()) {
        const entry = await cache.match(key);
        if (entry && expires(entry) <= Date.now()) await cache.delete(key);
      }
    }
    for (const name of (await caches.keys()).filter((name) => /^patchtree-go-index-v[123](?:-|$)/.test(name)))
      await caches.delete(name);
    return [indexes, archives] as [Cache, Cache];
  })().catch(() => {
    cacheReady = undefined;
    return null;
  });
  return cacheReady;
}

function saveArchive(cache: Cache, key: string, bytes: Uint8Array<ArrayBuffer>) {
  archiveWrites = archiveWrites.then(async () => {
    await cache.put(key, new Response(bytes, { headers: { [expiresHeader]: String(Date.now() + day) } }));
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - 4))) await cache.delete(old);
  }).catch(() => {});
  return archiveWrites;
}

async function sourceArchive(
  location: ReturnType<typeof archiveLocation>, storage: Cache | undefined, key: string, archiveBase64: unknown,
) {
  const saved = await getEntry(storage, key);
  if (saved) return new Uint8Array(await saved.arrayBuffer());
  let job = downloads.get(key);
  if (!job) {
    if (location.tokenHeader === "PRIVATE-TOKEN" && archiveBase64 === undefined) return null;
    job = (async () => {
      let archive: Uint8Array<ArrayBuffer>;
      if (location.tokenHeader === "PRIVATE-TOKEN") {
        if (typeof archiveBase64 !== "string" || archiveBase64.length > Math.ceil(maxArchiveBytes / 3) * 4)
          throw new Error("Missing or oversized GitLab source archive");
        archive = Uint8Array.from(atob(archiveBase64), (char) => char.charCodeAt(0));
        if (archive.length > maxArchiveBytes) throw new Error("Source archive exceeds 32 MiB");
      } else {
        const token = (await credentialFor(location.tokenHost, true, () => refreshOAuthToken(location.tokenHost)))?.token;
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        archive = await loadArchive(await fetch(location.archive, { headers, credentials: "omit" }));
      }
      if (storage) await saveArchive(storage, key, archive);
      return archive;
    })().finally(() => downloads.delete(key));
    downloads.set(key, job);
  }
  // Each dedicated worker takes ownership of its own buffer.
  return (await job).slice();
}

export async function repositoryIndex(
  sender: string | undefined, revision: unknown, source: unknown, language: unknown,
  cachedOnly: boolean, archiveBase64: unknown,
) {
  if (!sender || typeof revision !== "string" || !/^[a-f0-9]{40}$/i.test(revision)) throw new Error("Missing repository or full commit SHA");
  if (language !== "go" && language !== "typescript" && language !== "clang") throw new Error("Unsupported code index language");
  const location = archiveLocation(sender, source, revision);
  const archiveKey = `${location.repository}/.patchtree-source/${revision}?source=${encodeURIComponent(location.archive)}`;
  // The immutable source revision covers every in-tree compiler configuration.
  const key = `${archiveKey}&index=${PATCHTREE_INDEX_VERSION}&language=${language}`;
  const [indexes, archives] = await indexCaches() ?? [];
  const saved = await getEntry(indexes, key);
  if (saved) return { index: await saved.text(), gzip: saved.headers.get(encodingHeader) === "gzip" };
  if (cachedOnly) return null;
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      const archive = await sourceArchive(location, archives, archiveKey, archiveBase64);
      if (!archive) return null;
      const payload = await runIndex({ language, repository: location.repository, revision, archive });
      const response = new Response(payload.index, { headers: {
        [expiresHeader]: String(Date.now() + 30 * day),
        [encodingHeader]: payload.gzip ? "gzip" : "identity",
      } });
      await indexes?.put(key, response).catch(() => {});
      return payload;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}
