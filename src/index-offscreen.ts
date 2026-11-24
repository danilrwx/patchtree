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

import { fromBase64, runDedicatedWorker, workerResultURL, type IndexRequest } from "./index-runner";

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type !== "runBundledIndex" || sender.id !== chrome.runtime.id || sender.tab ||
      typeof msg.archive !== "string") return;
  const { language, repository, revision, chunkCache, buildContext, unitCache } = msg;
  const archive = fromBase64(msg.archive);
  const request: IndexRequest = { language, repository, revision, archive, chunkCache, buildContext, unitCache };
  const result = runDedicatedWorker(request).catch((error) => ({ error: String(error) }));
  if (language === "clang" && chunkCache) {
    const keepAlive = setInterval(() => {
      void chrome.runtime.sendMessage({ type: "repositoryIndexKeepAlive" }).catch(() => {});
    }, 10_000);
    void caches.open(chunkCache).then(async (cache) => {
      const reply = await result;
      await cache.put(workerResultURL, new Response(JSON.stringify(reply))).catch(async () =>
        cache.put(workerResultURL, new Response(JSON.stringify({ error: "Could not save the Clang index result" }))));
    }).catch(() => {}).finally(() => clearInterval(keepAlive));
    respond({ started: true });
    return;
  }
  void result.then(respond);
  return true;
});
