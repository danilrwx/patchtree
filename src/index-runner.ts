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

import type { IndexLanguage } from "./index-language";

export type IndexRequest = {
  language: IndexLanguage; repository: string; revision: string; archive: Uint8Array<ArrayBuffer>;
};
export type IndexPayload = { index: string; gzip?: boolean };
export type IndexReply = IndexPayload | { error: string };

let opening: Promise<void> | undefined;
const offscreenName = "index-offscreen.html";

function openOffscreen() {
  if (opening) return opening;
  opening = (async () => {
    const documentUrl = chrome.runtime.getURL(offscreenName);
    const contexts = chrome.runtime.getContexts
      ? await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [documentUrl] })
      : await (globalThis as unknown as ServiceWorkerGlobalScope).clients.matchAll({ includeUncontrolled: true });
    if (contexts.some((context) => ("url" in context ? context.url : context.documentUrl) === documentUrl)) return;
    await chrome.offscreen.createDocument({
      url: offscreenName,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Run bundled repository indexers in a dedicated Web Worker.",
    });
  })().finally(() => { opening = undefined; });
  return opening;
}

export function runDedicatedWorker(request: IndexRequest): Promise<IndexReply> {
  const worker = new Worker(new URL("./index-worker.js", location.href), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<IndexReply>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The repository index worker stopped"));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("Could not read the repository index"));
    };
    worker.postMessage(request, [request.archive.buffer]);
  });
}

export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export async function runIndex(request: IndexRequest) {
  let reply: IndexReply;
  if (typeof chrome.offscreen?.createDocument === "function") {
    await openOffscreen();
    reply = await chrome.runtime.sendMessage({
      type: "runBundledIndex", ...request, archive: toBase64(request.archive),
    });
  } else {
    reply = await runDedicatedWorker(request);
  }
  if ("error" in reply) throw new Error(reply.error);
  return reply;
}
