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

import { indexUnitStats, clearIndexUnits } from "./index-unit-cache";
import { credentialFor } from "./providers/shared";
import { refreshOAuthToken } from "./oauth";
import { archiveLocation, loadArchive, maxArchiveBytes, maxGoArchiveBytes } from "./source-archive";
import { chunkCachePrefix, fromBase64, runIndex, shardURL, toBase64, workerProgressURL, type IndexManifest, type IndexProgress, type IndexResult } from "./index-runner";
import { largeIndexArchive } from "./index-language";
import { indexCacheRevisionsKey, type CacheRevisions, type CacheSelection, type CacheStats } from "./index-cache-state";

declare const PATCHTREE_INDEX_VERSION: string;
type BuildResult = (IndexResult & { chunkCache?: string }) | { uploadRevision: string };
const pending = new Map<string, Promise<BuildResult>>();
type ClangBuild = { revision: string | undefined; id: string; chunkCache?: string; result?: BuildResult | { error: string } };
const clangBuilds = new Map<string, ClangBuild>();
const downloads = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const cacheName = "patchtree-index-v4";
const archiveCacheName = "patchtree-source-v1";
const expiresHeader = "X-Patchtree-Expires";
const encodingHeader = "X-Patchtree-Index-Encoding";
const sizeHeader = "X-Patchtree-Size";
const chunkHeader = "X-Patchtree-Chunk-Cache";
const maxSavedIndexBytes = 192 * 1024 * 1024;
const maxSavedIndexes = 8;
const day = 24 * 60 * 60 * 1000;
let cacheReady: Promise<[Cache, Cache] | null> | undefined;
let nextSweep = 0;
let cacheWrites: Promise<unknown> = Promise.resolve();
let cacheRevisions: Promise<CacheRevisions> | undefined;

function revisions() {
  return cacheRevisions ??= chrome.storage.local.get(indexCacheRevisionsKey)
    .then((data) => (data[indexCacheRevisionsKey] ?? {}) as CacheRevisions)
    .catch((error) => {
      cacheRevisions = undefined;
      throw error;
    });
}

function queueCacheWrite<T>(write: () => Promise<T>) {
  const job = cacheWrites.then(write);
  cacheWrites = job.catch(() => {});
  return job;
}

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
    const activeChunks = new Set<string>();
    for (const cache of [indexes, archives]) {
      for (const key of await cache.keys()) {
        const entry = await cache.match(key);
        if (!entry) continue;
        const chunkCache = entry.headers.get(chunkHeader);
        if (expires(entry) <= Date.now()) {
          await cache.delete(key);
          if (chunkCache) await caches.delete(chunkCache);
        } else if (chunkCache) activeChunks.add(chunkCache);
      }
    }
    for (const name of await caches.keys()) {
      if (/^patchtree-go-index-v[123](?:-|$)/.test(name) ||
          name.startsWith(chunkCachePrefix) && !activeChunks.has(name) && Date.now() - Number(name.slice(chunkCachePrefix.length).split("-", 1)[0]) > day)
        await caches.delete(name);
    }
    return [indexes, archives] as [Cache, Cache];
  })().catch(() => {
    cacheReady = undefined;
    return null;
  });
  return cacheReady;
}

async function cacheStats(cache: Cache) {
  const keys = await cache.keys();
  let bytes = 0;
  for (const key of keys) {
    const entry = await cache.match(key);
    if (!entry) continue;
    const size = entry.headers.get(sizeHeader);
    bytes += size === null ? (await entry.blob()).size : Number(size);
  }
  return { entries: keys.length, bytes };
}

async function saveIndex(cache: Cache, key: string, body: Blob, bytes: number, headers: Record<string, string>) {
  if (bytes > maxSavedIndexBytes) throw new Error("Code index exceeds the 192 MiB cache budget.");
  const previous = (await cache.match(key))?.headers.get(chunkHeader);
  let count = 1;
  let totalBytes = bytes;
  for (const old of [...await cache.keys()].reverse()) {
    if (old.url === key) continue;
    const entry = await cache.match(old);
    if (!entry) continue;
    const size = Number(entry.headers.get(sizeHeader));
    if (count < maxSavedIndexes && totalBytes + size <= maxSavedIndexBytes) {
      count++;
      totalBytes += size;
    } else {
      await cache.delete(old);
      const chunk = entry.headers.get(chunkHeader);
      if (chunk?.startsWith(chunkCachePrefix)) await caches.delete(chunk);
    }
  }
  await cache.put(key, new Response(body, { headers: {
    ...headers,
    [expiresHeader]: String(Date.now() + 30 * day),
    [sizeHeader]: String(bytes),
  } }));
  if (previous?.startsWith(chunkCachePrefix)) await caches.delete(previous).catch(() => {});
}

export function manageIndexCaches(clear?: CacheSelection) {
  return queueCacheWrite(async () => {
    const caches = await indexCaches();
    if (!caches) throw new Error("Code index cache storage is unavailable.");
    const [indexes, sources] = caches;
    const versions = clear ? await revisions() : undefined;
    if (versions) {
      if (clear === "indexes" || clear === "all") {
        const epoch = crypto.randomUUID();
        await clearIndexUnits(epoch);
        for (const key of await indexes.keys()) await indexes.delete(key);
        for (const name of await self.caches.keys()) if (name.startsWith(chunkCachePrefix)) await self.caches.delete(name);
        versions.indexes = epoch;
        pending.clear();
      }
      if (clear === "sources" || clear === "all") {
        for (const key of await sources.keys()) await sources.delete(key);
        versions.sources = crypto.randomUUID();
        downloads.clear();
      }
      // The content scripts use this change to discard cached indexes, and GitLab
      // uploads carry the source revision across worker restarts.
      await chrome.storage.local.set({ [indexCacheRevisionsKey]: versions });
    }
    const stats: CacheStats = {
      indexes: await cacheStats(indexes),
      sources: await cacheStats(sources),
      reusable: await indexUnitStats().catch(() => ({ bytes: 0, entries: 0 })),
    };
    return { stats, revisions: versions && { ...versions } };
  });
}

function saveArchive(cache: Cache, key: string, bytes: Uint8Array<ArrayBuffer>, sourceRevision: string) {
  return queueCacheWrite(async () => {
    if (((await revisions()).sources ?? "") !== sourceRevision) return;
    await cache.put(key, new Response(bytes, { headers: {
      [expiresHeader]: String(Date.now() + day),
      [sizeHeader]: String(bytes.byteLength),
    } }));
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - 4))) await cache.delete(old);
  }).catch(() => {});
}

async function sourceArchive(
  location: ReturnType<typeof archiveLocation>, storage: Cache | undefined, key: string,
  archiveBase64: unknown, token: string | undefined, sourceRevision: string, maximum: number,
) {
  const saved = await getEntry(storage, key);
  if (saved) {
    const bytes = new Uint8Array(await saved.arrayBuffer());
    if (bytes.length > maximum) throw new Error(`Source archive exceeds ${maximum / (1024 * 1024)} MiB`);
    return bytes;
  }
  const downloadKey = `${key}:${sourceRevision}`;
  let job = downloads.get(downloadKey);
  if (!job) {
    if (location.tokenHeader === "PRIVATE-TOKEN" && archiveBase64 === undefined) return null;
    const download = (async () => {
      let archive: Uint8Array<ArrayBuffer>;
      if (location.tokenHeader === "PRIVATE-TOKEN") {
        if (typeof archiveBase64 !== "string" || archiveBase64.length > Math.ceil(maxGoArchiveBytes / 3) * 4)
          throw new Error("Missing or oversized GitLab source archive");
        archive = fromBase64(archiveBase64);
        if (archive.length > maxGoArchiveBytes) throw new Error("Source archive exceeds 45 MiB");
      } else {
        archive = await loadArchive(await fetch(location.archive, { headers: { Authorization: `Bearer ${token}` }, credentials: "omit" }), maxGoArchiveBytes);
      }
      if (storage) await saveArchive(storage, key, archive, sourceRevision);
      return archive;
    })().finally(() => {
      if (downloads.get(downloadKey) === download) downloads.delete(downloadKey);
    });
    job = download;
    downloads.set(downloadKey, job);
  }
  // Each dedicated worker takes ownership of its own buffer.
  const bytes = await job;
  if (bytes.length > maximum) throw new Error(`Source archive exceeds ${maximum / (1024 * 1024)} MiB`);
  return bytes.slice();
}

function indexLocation(sender: string | undefined, revision: unknown, source: unknown, language: unknown) {
  if (!sender || typeof revision !== "string" || !/^[a-f0-9]{40}$/i.test(revision)) throw new Error("Missing repository or full commit SHA");
  if (language !== "go" && language !== "typescript" && language !== "clang") throw new Error("Unsupported code index language");
  const location = archiveLocation(sender, source, revision);
  const archiveKey = `${location.repository}/.patchtree-source/${revision}?source=${encodeURIComponent(location.archive)}`;
  // The immutable source revision covers every in-tree compiler configuration.
  const key = `${archiveKey}&index=${PATCHTREE_INDEX_VERSION}&language=${language}`;
  return { location, archiveKey, key, language, revision } as const;
}

async function indexToken(location: ReturnType<typeof archiveLocation>) {
  if (location.tokenHeader !== "Authorization") return undefined;
  const token = (await credentialFor(location.tokenHost, true, () => refreshOAuthToken(location.tokenHost)))?.token;
  if (!token) throw new Error("Sign in to build a code index.");
  return token;
}

export async function repositoryIndexShard(sender: string | undefined, revision: unknown, source: unknown, language: unknown, id: unknown, expectedCache: unknown) {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) throw new Error("Invalid index chunk");
  const { key, location } = indexLocation(sender, revision, source, language);
  await indexToken(location);
  await cacheWrites;
  const [indexes] = await indexCaches() ?? [];
  const entry = await getEntry(indexes, key);
  const name = entry?.headers.get(chunkHeader);
  if (!name?.startsWith(chunkCachePrefix) || name !== expectedCache) throw new Error("Code index was cleared or rebuilt");
  const part = await caches.match(shardURL(id), { cacheName: name });
  if (!part) throw new Error("Code index chunk is unavailable");
  return { index: toBase64(new Uint8Array(await part.arrayBuffer())), gzip: true };
}

export async function repositoryIndex(
  sender: string | undefined, requestedRevision: unknown, source: unknown, requestedLanguage: unknown,
  cachedOnly: boolean, archiveBase64: unknown, uploadRevision: unknown, contextBase64: unknown, poll: unknown,
) {
  const { location, archiveKey, key, language, revision } = indexLocation(sender, requestedRevision, source, requestedLanguage);
  const token = await indexToken(location);
  await cacheWrites;
  const versions = await revisions();
  const indexRevision = versions.indexes;
  const sourceRevision = versions.sources ?? "";
  if (poll !== undefined) {
    const entry = clangBuilds.get(key);
    if (!entry || entry.id !== poll || entry.revision !== indexRevision)
      throw new Error("The index build is no longer running. Try indexing again.");
    if (entry.result) return entry.result;
    const progress = entry.chunkCache && await caches.match(workerProgressURL, { cacheName: entry.chunkCache });
    return { job: entry.id, progress: progress ? await progress.json() as IndexProgress : undefined };
  }
  const buildContext = contextBase64 !== undefined;
  if (buildContext && (language !== "clang" || typeof contextBase64 !== "string" ||
      contextBase64.length > Math.ceil(maxArchiveBytes / 3) * 4))
    throw new Error("Missing or oversized C/C++ build context");
  const contextKey = `${archiveKey}&build-context=clang`;
  const expectedUpload = `${indexRevision ?? ""}:${sourceRevision}`;
  if (archiveBase64 !== undefined && uploadRevision !== expectedUpload)
    throw new Error("Code index caches changed. Try indexing again.");
  const [indexes, archives] = await indexCaches() ?? [];
  const saved = await getEntry(indexes, key);
  if (indexRevision !== versions.indexes) throw new Error("Indexes were cleared. Try indexing again.");
  if (saved && !buildContext) {
    const index = await saved.text();
    if (indexRevision !== versions.indexes) throw new Error("Indexes were cleared. Try indexing again.");
    const chunkCache = saved.headers.get(chunkHeader);
    return chunkCache ? { manifest: JSON.parse(index) as IndexManifest, chunkCache } :
      { index, gzip: saved.headers.get(encodingHeader) === "gzip" };
  }
  if (cachedOnly) return null;
  const active = clangBuilds.get(key);
  if (active && !active.result && active.revision === indexRevision) {
    if (buildContext) throw new Error("A C/C++ index build is already running.");
    return { job: active.id };
  }
  let job = pending.get(key);
  if (!job) {
    const entry: ClangBuild | undefined = language === "clang"
      ? { revision: indexRevision, id: crypto.randomUUID() } : undefined;
    const build = (async () => {
      const limit = language === "go" ? maxGoArchiveBytes : maxArchiveBytes;
      const existingContext = language === "clang" && !buildContext ? await getEntry(archives, contextKey) : undefined;
      const archive = buildContext ? fromBase64(contextBase64 as string) :
        existingContext ? new Uint8Array(await existingContext.arrayBuffer()) :
        await sourceArchive(location, archives, archiveKey, archiveBase64, token, sourceRevision, limit);
      if (!archive) return { uploadRevision: expectedUpload };
      if (archive.length > limit) throw new Error(`Source archive exceeds ${limit / (1024 * 1024)} MiB`);
      const request = {
        language, repository: location.repository, revision, archive, buildContext: buildContext || !!existingContext,
        unitCache: language === "clang" || language === "go" ? {
          scope: JSON.stringify([PATCHTREE_INDEX_VERSION, location.repository, location.sourceProject]),
          epoch: indexRevision ?? "",
        } : undefined,
      };
      const chunked = async () => {
        if (!indexes) throw new Error("Code index cache storage is unavailable.");
        const chunkCache = `${chunkCachePrefix}${Date.now()}-${crypto.randomUUID()}`;
        if (entry) entry.chunkCache = chunkCache;
        let published = false;
        try {
          const result = await runIndex({ ...request, archive: buildContext ? archive.slice() : archive, chunkCache });
          if (entry) await caches.open(chunkCache).then((cache) => cache.delete(workerProgressURL)).catch(() => {});
          if (!("manifest" in result)) throw new Error("Could not read the index manifest");
          await queueCacheWrite(async () => {
            if (indexRevision !== versions.indexes) throw new Error("Indexes were cleared. Try indexing again.");
            const body = new Blob([JSON.stringify(result.manifest)]);
            await saveIndex(indexes, key, body, body.size + result.manifest.bytes, { [chunkHeader]: chunkCache });
            published = true;
          });
          if (buildContext && archives) await saveArchive(archives, contextKey, archive, sourceRevision);
          return { ...result, chunkCache };
        } finally {
          if (!published) await caches.delete(chunkCache).catch(() => {});
        }
      };
      if (request.buildContext || (language === "clang" || language === "go") && indexes ||
          language === "go" && archive.length >= largeIndexArchive) return chunked();
      let payload: IndexResult;
      try {
        payload = await runIndex(language === "typescript" ? request : { ...request, archive: archive.slice() });
      } catch (error) {
        if (error instanceof Error && (language === "clang" && error.message.startsWith("Code index exceeds") ||
            language === "go" && /^(?:expanded source archive exceeds|Go sources exceed|Code index exceeds)/.test(error.message)))
          return chunked();
        throw error;
      }
      if (!("index" in payload)) throw new Error("Could not read the repository index");
      if (indexes) await queueCacheWrite(async () => {
        if (indexRevision !== versions.indexes) return;
        const body = new Blob([payload.index]);
        await saveIndex(indexes, key, body, body.size, { [encodingHeader]: payload.gzip ? "gzip" : "identity" });
      }).catch(() => {});
      if (indexRevision !== versions.indexes) throw new Error("Indexes were cleared. Try indexing again.");
      return payload;
    })().finally(() => {
      if (pending.get(key) === build) pending.delete(key);
    });
    job = build;
    if (entry) {
      clangBuilds.set(key, entry);
      const finish = (result: NonNullable<typeof entry.result>) => {
        entry.result = result;
        setTimeout(() => { if (clangBuilds.get(key) === entry) clangBuilds.delete(key); }, 60_000);
      };
      void job.then(finish, (error) => finish({ error: error instanceof Error ? error.message : String(error) }));
      return { job: entry.id };
    }
    pending.set(key, job);
  }
  return job;
}
