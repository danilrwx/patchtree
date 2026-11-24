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

// @ts-expect-error — the Go runtime is copied from the pinned toolchain at build time.
import "./assets/code-index/wasm_exec.js";
import type TS from "typescript-compiler-api";
import { indexClang, scanClang, type ClangFactory, type Occurrence } from "./clang-index";
import { clangUnitCache, goUnitCache } from "./index-unit-cache";
import { NavigationMap } from "./navigation-map";
import { readSnapshot } from "./snapshot";
import { indexTypeScript } from "./typescript-index";
import { shardURL, sourceDirectory, symbolKey, workerProgressURL, type IndexManifest, type IndexProgress, type IndexPayload, type IndexReply, type IndexRequest } from "./index-runner";

type GoCacheCallbacks = {
  prepare(ids: string): Promise<void>;
  load(id: string, key: string): Promise<string>;
};

type Go = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};
const runtime = globalThis as typeof globalThis & {
  Go: new () => Go;
  codeIndexGoArchive(repository: string, revision: string, archive: Uint8Array,
    emit?: (json: string, id: string, key: string, diagnostics: string) => Promise<void>,
    cache?: GoCacheCallbacks): string | Promise<string>;
};
const directory = new URL("assets/code-index/", self.location.href);
const asset = (path: string) => new URL(path, directory).href;
const maxResultBytes = 128 * 1024 * 1024;

async function readAsset(path: string) {
  const response = await fetch(asset(path));
  if (!response.ok) throw new Error(`Bundled indexer asset is unavailable: ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function build({ language, repository, revision, archive }: IndexRequest) {
  if (language === "go") {
    const go = new runtime.Go();
    const { instance } = await WebAssembly.instantiate(await readAsset("code-index.wasm"), go.importObject);
    void go.run(instance);
    if (!runtime.codeIndexGoArchive) throw new Error("Go indexer failed to initialize");
    const text = await runtime.codeIndexGoArchive(repository, revision, archive);
    if (typeof text !== "string") throw new Error("Go Wasm stopped before returning an index");
    if (text.startsWith('{"error":')) throw new Error(JSON.parse(text).error);
    return text;
  }
  const snapshot = readSnapshot(archive);
  if (language === "typescript") {
    const [{ default: ts }, files, libraries] = await Promise.all([
      import(asset("typescript.js")) as Promise<{ default: typeof TS }>,
      snapshot,
      readAsset("typescript-libs.tar.gz").then((bytes) => readSnapshot(bytes, false)),
    ]);
    return indexTypeScript(ts, files, libraries).serialize(repository, revision);
  }
  const [factory, files, headers] = await clangInputs(snapshot);
  return (await indexClang(factory, asset, files, headers)).serialize(repository, revision);
}

async function clangInputs(snapshot: ReturnType<typeof readSnapshot>) {
  const [{ default: factory }, files, headers] = await Promise.all([
    import(asset("patchtree-clang.js")) as Promise<{ default: ClangFactory }>,
    snapshot,
    readAsset("clang-headers.tar.gz").then((bytes) => readSnapshot(bytes, false)),
  ]);
  return [factory, files, headers] as const;
}

type IndexShard = Record<string, Record<string, { spans: { targets: { path: string; line: number; column: number }[] }[] }>>;

async function shardWriter({ repository, revision, chunkCache, language }: IndexRequest) {
  const cache = await caches.open(chunkCache!);
  const files: IndexManifest["files"] = Object.create(null);
  const packages: IndexManifest["packages"] = Object.create(null);
  const references: IndexManifest["references"] = Object.create(null);
  let number = 0;
  let bytes = 0;
  const store = async (body: Blob, paths: IndexShard, packed?: Blob) => {
    const id = ++number;
    const directories = new Set<string>();
    const symbols = new Set<string>();
    for (const [path, rows] of Object.entries(paths)) {
      files[path] = id;
      const dir = sourceDirectory(path);
      directories.add(dir);
      for (const row of Object.values(rows)) for (const span of row.spans) for (const target of span.targets) {
        if (language === "clang" || sourceDirectory(target.path) !== dir) symbols.add(symbolKey(target.path, target.line, target.column));
      }
    }
    for (const dir of directories) (packages[dir] ??= []).push(id);
    for (const symbol of symbols) (references[symbol] ??= []).push(id);
    const compressed = packed ?? await new Response(body.stream().pipeThrough(new CompressionStream("gzip"))).blob();
    if (compressed.size > 16 * 1024 * 1024) throw new Error("An index chunk exceeds 16 MiB compressed");
    await cache.put(shardURL(id), new Response(compressed));
    bytes += compressed.size;
    return compressed;
  };
  return { cache, store, manifest: (diagnostics: string[]): IndexManifest =>
    ({ repository, revision, files, packages, references, diagnostics, bytes }) };
}

async function chunkedGo(request: IndexRequest): Promise<IndexManifest> {
  const { repository, revision, archive } = request;
  const { store, manifest } = await shardWriter(request);
  const go = new runtime.Go();
  const { instance } = await WebAssembly.instantiate(await readAsset("code-index.wasm"), go.importObject);
  let stopped: (() => void) | undefined;
  const exited = new Promise<never>((_, reject) => { stopped = () => reject(new Error("Go Wasm stopped before returning an index")); });
  void go.run(instance).then(stopped, stopped);
  const reuse = request.unitCache && await goUnitCache(request.unitCache.scope, request.unitCache.epoch).catch(() => undefined);
  const callbacks: GoCacheCallbacks | undefined = reuse && {
    async prepare(ids) { reuse.prepare(JSON.parse(ids) as string[]); },
    async load(id, key) {
      const hit = await reuse.load(id, key).catch(() => undefined);
      if (!hit) return "";
      const body = await new Response(hit.rows.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
      const paths = JSON.parse(await body.text()) as IndexShard;
      if (Object.keys(paths).length) await store(body, paths, hit.rows);
      return hit.diagnostics ?? "[]";
    },
  };
  const emit = async (text: string, id: string, key: string, diagnostics: string) => {
    const paths = JSON.parse(text) as IndexShard;
    const body = new Blob([text]);
    if (body.size <= 12 * 1024 * 1024) {
      let packed = Object.keys(paths).length ? await store(body, paths) : undefined;
      if (reuse && key) {
        packed ??= await new Response(body.stream().pipeThrough(new CompressionStream("gzip"))).blob();
        await reuse.save(id, key, packed, diagnostics).catch(() => {});
      }
    } else for (const [path, rows] of Object.entries(paths)) {
      const file = { [path]: rows };
      await store(new Blob([JSON.stringify(file)]), file);
    }
  };
  const index = callbacks ? runtime.codeIndexGoArchive(repository, revision, archive, emit, callbacks) :
    runtime.codeIndexGoArchive(repository, revision, archive, emit);
  const result = await Promise.race([exited, index]);
  const meta = JSON.parse(result) as { error?: string; diagnostics?: string[]; analysis?: IndexManifest["analysis"] };
  if (meta.error) throw new Error(meta.error);
  const diagnostics = meta.diagnostics?.slice(0, 60) ?? [];
  if (meta.diagnostics && meta.diagnostics.length > diagnostics.length)
    diagnostics.push(`${meta.diagnostics.length - diagnostics.length} more diagnostics`);
  return { ...manifest(diagnostics), analysis: meta.analysis };
}

async function chunkedClang(request: IndexRequest): Promise<IndexManifest> {
  const [factory, snapshot, headers] = await clangInputs(readSnapshot(request.archive));
  if (request.buildContext) {
    const marker = snapshot.get("patchtree-build-context.json");
    if (!marker || JSON.parse(new TextDecoder().decode(marker)).revision !== request.revision)
      throw new Error("Build context belongs to a different revision or is missing patchtree-build-context.json");
  }
  const { cache, store, manifest } = await shardWriter(request);
  const bucketCount = 32;
  const buckets = Array.from({ length: bucketCount }, () => new Map<string, Occurrence>());
  const parts = buckets.map(() => [] as string[]);
  const pathBuckets = new Map<string, number>();
  const definitions = new Map<string, { kind: 1 | 2; points: Map<string, NonNullable<ReturnType<NavigationMap["locate"]>>> }>();
  const locations = new NavigationMap(snapshot);
  let size = 0;
  let batch = 0;
  const keyFor = ([path, offset, width, , usr]: Occurrence) => JSON.stringify([path, offset, width, usr]);
  const collect = (row: Occurrence) => {
    const [path, offset, , kind, usr] = row;
    let bucket = pathBuckets.get(path);
    if (bucket === undefined) {
      let hash = 0;
      for (let i = 0; i < path.length; i++) hash = Math.imul(hash, 31) + path.charCodeAt(i);
      bucket = (hash >>> 0) % bucketCount;
      pathBuckets.set(path, bucket);
    }
    const rows = buckets[bucket];
    const key = keyFor(row);
    const previous = rows.get(key);
    if (previous && previous[3] >= kind) return;
    rows.set(key, row);
    if (!previous) size++;
    if (!kind) return;
    let target = definitions.get(usr);
    if (target && target.kind > kind) return;
    if (!target || target.kind < kind) definitions.set(usr, target = { kind, points: new Map() });
    const pointKey = JSON.stringify([path, offset]);
    if (target.points.has(pointKey)) return;
    const point = locations.locate(path, offset);
    if (point) target.points.set(pointKey, point);
  };
  const spill = async () => {
    if (!size) return;
    for (const [i, rows] of buckets.entries()) {
      if (!rows.size) continue;
      const url = `https://patchtree.invalid/work/${batch}/${i}`;
      const data = new Blob([JSON.stringify([...rows.values()])]);
      await cache.put(url, new Response(data.stream().pipeThrough(new CompressionStream("gzip"))));
      parts[i].push(url);
      rows.clear();
    }
    size = 0;
    batch++;
  };
  const report = (progress: IndexProgress) =>
    cache.put(workerProgressURL, new Response(JSON.stringify(progress))).catch(() => {});
  let lastReport = 0;
  const reuse = request.unitCache && await clangUnitCache(snapshot, request.unitCache.scope, request.unitCache.epoch)
    .catch(() => undefined);
  const { diagnostics, reused, units } = await scanClang(factory, asset, snapshot, headers, collect, async (progress) => {
    const now = performance.now();
    if ("completed" in progress && (progress.completed === 0 || progress.completed === progress.total || now - lastReport >= 750)) {
      lastReport = now;
      await report(progress);
    }
    if (size >= 100_000) await spill();
  }, request.buildContext, reuse);
  await report({ phase: "saving" });
  await spill();

  for (const urls of parts) {
    // All occurrences for a source path land in the same bucket.
    const rows = new Map<string, Occurrence>();
    for (const url of urls) {
      const part = await cache.match(url);
      if (!part?.body) throw new Error("Temporary Clang index data is unavailable");
      const data = await new Response(part.body.pipeThrough(new DecompressionStream("gzip"))).json() as Occurrence[];
      for (const row of data) rows.set(keyFor(row), row);
      await cache.delete(url);
    }
    const navigation = new NavigationMap(snapshot);
    const bySymbol = new Map<string, NonNullable<ReturnType<NavigationMap["locate"]>>[]>();
    for (const [path, offset, width, , usr] of rows.values()) {
      const definition = definitions.get(usr);
      if (!definition) continue;
      let targets = bySymbol.get(usr);
      if (!targets) bySymbol.set(usr, targets = [...definition.points.values()]);
      const from = navigation.locate(path, offset);
      if (from) navigation.add(from, width, targets);
    }
    let paths: IndexShard = Object.create(null);
    let estimated = 0;
    for (const [path, lines] of Object.entries(navigation.files)) {
      const length = JSON.stringify(lines).length;
      if (estimated && estimated + length > 1024 * 1024) {
        await store(new Blob([JSON.stringify(paths)]), paths);
        paths = Object.create(null);
        estimated = 0;
      }
      paths[path] = lines;
      estimated += length;
    }
    if (estimated) await store(new Blob([JSON.stringify(paths)]), paths);
  }
  return { ...manifest(diagnostics), analysis: { reused, units } };
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

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<IndexRequest>) => {
  const respond = (reply: IndexReply) => worker.postMessage(reply);
  const request = event.data;
  const index = request.chunkCache
    ? (request.language === "go" ? chunkedGo(request) : chunkedClang(request)).then((manifest) => ({ manifest }))
    : build(request).then(packIndex);
  index.then(respond, (error) =>
    respond({ error: error instanceof Error ? error.message : String(error) }));
};
