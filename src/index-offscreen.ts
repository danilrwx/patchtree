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

import { runDedicatedWorker, type IndexRequest } from "./index-runner";

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type !== "runBundledIndex" || sender.id !== chrome.runtime.id || sender.tab ||
      typeof msg.archive !== "string") return;
  const { language, repository, revision } = msg;
  const archive = Uint8Array.from(atob(msg.archive), (char) => char.charCodeAt(0));
  const request: IndexRequest = { language, repository, revision, archive };
  runDedicatedWorker(request).then(respond, (error) => respond({ error: String(error) }));
  return true;
});
