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

// @ts-expect-error — the Go runtime is copied from the toolchain at build time
import "./assets/code-index/wasm_exec.js";
import { credentialFor } from "./providers/shared";
import { refreshOAuthToken } from "./oauth";
import { archiveLocation, loadArchive, maxArchiveBytes } from "./source-archive";

// Tree-sitter checks process.versions.node when the Go browser shim exposes process.
const goProcess: { versions?: unknown } | undefined = Reflect.get(globalThis, "process");
if (goProcess && !goProcess.versions) Object.defineProperty(goProcess, "versions", { value: {} });

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

const runtime = globalThis as typeof globalThis & {
  Go: new () => GoRuntime;
  codeIndexGoArchive(repository: string, revision: string, archive: Uint8Array): string;
};

type IndexPayload = { index: string; gzip?: boolean };
const pending = new Map<string, Promise<IndexPayload>>();
const cacheName = "patchtree-go-index-v3";
const expiresHeader = "X-Patchtree-Expires";
const encodingHeader = "X-Patchtree-Index-Encoding";
const day = 24 * 60 * 60 * 1000;
const indexTTL = 30 * day;
const maxResultBytes = 128 * 1024 * 1024;
let cacheReady: Promise<Cache | null> | undefined;
let nextSweep = 0;
let ready: Promise<void> | undefined;

function expires(response: Response) {
  return Number(response.headers.get(expiresHeader));
}

function cacheResponse(payload: IndexPayload) {
  return new Response(payload.index, { headers: {
    [expiresHeader]: String(Date.now() + indexTTL),
    [encodingHeader]: payload.gzip ? "gzip" : "identity",
  } });
}

async function packIndex(text: string): Promise<IndexPayload> {
  const raw = new Blob([text]);
  if (raw.size > maxResultBytes) throw new Error("Code index exceeds 128 MiB");
  if (raw.size <= 4 * 1024 * 1024) return { index: text };
  const compressed = new Uint8Array(await new Response(raw.stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let binary = "";
  for (let i = 0; i < compressed.length; i += 8192)
    binary += String.fromCharCode(...compressed.subarray(i, i + 8192));
  return { index: btoa(binary), gzip: true };
}

function indexCache() {
  if (cacheReady && Date.now() < nextSweep) return cacheReady;
  nextSweep = Date.now() + day;
  cacheReady = (async () => {
    const cache = await caches.open(cacheName);
    for (const key of await cache.keys()) {
      const entry = await cache.match(key);
      if (entry && expires(entry) <= Date.now()) await cache.delete(key);
    }
    // Older indexes could omit packages from the same Go workspace.
    for (const name of (await caches.keys()).filter((name) => /^patchtree-go-index-v[12](?:-|$)/.test(name)))
      await caches.delete(name);
    return cache;
  })().catch(() => {
    cacheReady = undefined;
    return null;
  });
  return cacheReady;
}

async function initGo() {
  const go = new runtime.Go();
  const response = await fetch(chrome.runtime.getURL("assets/code-index/code-index.wasm"));
  if (!response.ok) throw new Error("Bundled Go indexer is unavailable");
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
  // The Go main loop remains alive to serve synchronous indexing calls.
  void go.run(instance).catch(() => { ready = undefined; });
  if (!runtime.codeIndexGoArchive) throw new Error("Go indexer failed to initialize");
}

export async function repositoryIndex(sender: string | undefined, revision: unknown, source: unknown, cachedOnly: boolean, archiveBase64: unknown) {
  if (!sender || typeof revision !== "string" || !/^[a-f0-9]{40}$/i.test(revision)) throw new Error("Missing repository or full commit SHA");
  const location = archiveLocation(sender, source, revision);
  const key = `${location.repository}/.patchtree-index/${revision}`;
  const storage = await indexCache();
  const saved = await storage?.match(key).catch(() => undefined);
  if (saved && expires(saved) > Date.now()) {
    return { index: await saved.text(), gzip: saved.headers.get(encodingHeader) === "gzip" };
  }
  if (cachedOnly) return null;
  let job = pending.get(key);
  if (!job) {
    job = (async () => {
      let archive: Uint8Array;
      if (location.tokenHeader === "PRIVATE-TOKEN") {
        if (typeof archiveBase64 !== "string" || archiveBase64.length > Math.ceil(maxArchiveBytes / 3) * 4)
          throw new Error("Missing or oversized GitLab source archive");
        archive = Uint8Array.from(atob(archiveBase64), (char) => char.charCodeAt(0));
      } else {
        const token = (await credentialFor(location.tokenHost, true, () => refreshOAuthToken(location.tokenHost)))?.token;
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const response = await fetch(location.archive, { headers, credentials: "omit" });
        archive = await loadArchive(response);
      }
      ready ??= initGo().catch((error) => {
        ready = undefined;
        throw error;
      });
      await ready;
      const text = runtime.codeIndexGoArchive(location.repository, revision, archive);
      if (text.startsWith('{"error":')) throw new Error(JSON.parse(text).error);
      const payload = await packIndex(text);
      await storage?.put(key, cacheResponse(payload)).catch(() => {});
      return payload;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}
