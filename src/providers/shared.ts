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

// Helpers shared by the gitlab and github providers. Concrete utilities, not a
// base class — the two providers stay two honest implementations.

import { imageMime } from "../diff";
import type { Refs, Side } from "../types";

// tokens live in storage.local (never synced to the browser vendor's cloud);
// migrate any previously sync-stored tokens on first read
export async function readTokens(): Promise<Record<string, { token?: string }>> {
  type Tokens = Record<string, { token?: string }>;
  const local = await chrome.storage.local.get("gitlabs");
  if (local.gitlabs) return local.gitlabs as Tokens;
  const { gitlabs } = await chrome.storage.sync.get("gitlabs");
  if (gitlabs) {
    await chrome.storage.local.set({ gitlabs });
    chrome.storage.sync.remove("gitlabs");
    return gitlabs as Tokens;
  }
  return {};
}

export const tokenFor = (host: string) => readTokens().then((g) => g[host]?.token || null);

// Raise a trimmed `<status> <body>` error for a failed response.
export async function throwIfBad(resp: Response): Promise<void> {
  if (!resp.ok)
    throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 200));
}

// Memoize a file fetch, evicting the key on failure so a later retry can refetch.
export function cachedFetch(
  cache: Map<string, Promise<string[]>>,
  key: string,
  fn: () => Promise<string[]>
): Promise<string[]> {
  if (!cache.has(key))
    cache.set(
      key,
      fn().catch((e) => {
        cache.delete(key);
        throw e;
      })
    );
  return cache.get(key)!;
}

// Image preview: wait for refs (or give up after 8s), pick the side's ref, then
// let the provider fetch the base64 for that ref. `getRefs` is read lazily since
// refs may still be null when the image mounts.
export async function imageDataUrl(
  path: string,
  side: Side,
  refsReady: Promise<void>,
  getRefs: () => Refs | null,
  fetchBase64: (ref: string) => Promise<string | null>
): Promise<string | null> {
  const mime = imageMime(path);
  if (!mime) return null;
  await Promise.race([refsReady, new Promise((r) => setTimeout(r, 8000))]);
  const ref = side === "old" ? getRefs()?.baseSha : getRefs()?.headSha;
  if (!ref) return null;
  try {
    const b64 = await fetchBase64(ref);
    return b64 ? `data:${mime};base64,${b64}` : null;
  } catch {
    return null;
  }
}

// permalink/blobUrl builders off a repo blob base (e.g. ".../-/blob").
export function blobLinks(repoBlobBase: string, getRefs: () => Refs | null) {
  return {
    permalink: (path: string, side: string, line: number) => {
      const r = getRefs();
      if (!r) return null;
      const sha = side === "old" ? r.baseSha : r.headSha;
      return `${repoBlobBase}/${sha}/${encodeURI(path)}#L${line}`;
    },
    blobUrl: (path: string) => {
      const r = getRefs();
      return r ? `${repoBlobBase}/${r.headSha}/${encodeURI(path)}` : null;
    },
  };
}
