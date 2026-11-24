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
import { indexClang, type ClangFactory } from "./clang-index";
import { readSnapshot } from "./snapshot";
import { indexTypeScript } from "./typescript-index";
import type { IndexPayload, IndexReply, IndexRequest } from "./index-runner";

type Go = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};
const runtime = globalThis as typeof globalThis & {
  Go: new () => Go;
  codeIndexGoArchive(repository: string, revision: string, archive: Uint8Array): string;
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
    const text = runtime.codeIndexGoArchive(repository, revision, archive);
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
  const [{ default: factory }, files, headers] = await Promise.all([
    import(asset("patchtree-clang.js")) as Promise<{ default: ClangFactory }>,
    snapshot,
    readAsset("clang-headers.tar.gz").then((bytes) => readSnapshot(bytes, false)),
  ]);
  return (await indexClang(factory, asset, files, headers)).serialize(repository, revision);
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
  build(event.data).then(packIndex).then(respond, (error) =>
    respond({ error: error instanceof Error ? error.message : String(error) }));
};
