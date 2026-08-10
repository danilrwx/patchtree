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

// Access-tokens overlay: per-GitLab-host PATs plus a GitHub token, stored in
// storage.local and never synced. Ported from the imperative openTokensDialog.
import { For, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { onEscape } from "../a11y";

interface Row {
  host: string;
  token: string;
}

export function TokensDialog(props: { onClose: () => void }) {
  const [hosts, setHosts] = createStore<Row[]>([{ host: "", token: "" }]);
  const [gh, setGh] = createStore<{ token: string }>({ token: "" });

  onMount(async () => {
    let { gitlabs } = await chrome.storage.local.get("gitlabs");
    if (!gitlabs) ({ gitlabs = {} } = await chrome.storage.sync.get("gitlabs"));
    const all = (gitlabs || {}) as Record<string, { token?: string }>;
    const gl = Object.entries(all)
      .filter(([h]) => h !== "github.com")
      .map(([host, v]) => ({ host, token: v.token || "" }));
    setHosts(gl.length ? gl : [{ host: "", token: "" }]);
    setGh("token", all["github.com"]?.token || "");
  });

  const save = () => {
    const m: Record<string, { token: string }> = {};
    for (const r of hosts) {
      const host = r.host.trim();
      if (host && host !== "github.com") m[host] = { token: r.token.trim() };
    }
    if (gh.token.trim()) m["github.com"] = { token: gh.token.trim() };
    chrome.storage.local.set({ gitlabs: m });
  };

  const close = () => {
    save();
    props.onClose();
  };

  onEscape(close);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click-outside is a mouse convenience, Escape and the Done button close it for keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above — Escape handles the keyboard path
    <div id="pt-tokens-dialog" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="pt-dialog pt-tokens">
        <div class="pt-gallery-head">
          <h3>Access tokens</h3>
        </div>
        <p>
          Tokens enable review actions; they are stored locally and never leave the browser except
          to their own host. Changes apply after reloading the diff page.
        </p>

        <div>
          <h4>GitLab instances</h4>
          <p>
            Personal access token with the <code>api</code> scope.
          </p>
          <table class="pt-tokens-table">
            <tbody>
              <For each={hosts}>
                {(r, i) => (
                  <tr>
                    <td>
                      <input
                        placeholder="gitlab.example.com"
                        value={r.host}
                        onInput={(e) => setHosts(i(), "host", e.currentTarget.value)}
                        onChange={save}
                      />
                    </td>
                    <td>
                      <input
                        type="password"
                        placeholder="glpat-…"
                        value={r.token}
                        onInput={(e) => setHosts(i(), "token", e.currentTarget.value)}
                        onChange={save}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setHosts((rows) => rows.filter((_, j) => j !== i()));
                          save();
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <button
            type="button"
            class="pt-token-add"
            onClick={() => setHosts(hosts.length, { host: "", token: "" })}
          >
            Add instance
          </button>
        </div>

        <div>
          <h4>GitHub</h4>
          <p>
            Classic token (<code>repo</code> scope) or a fine-grained token with Pull requests read
            &amp; write. Used on github.com and patch-diff.githubusercontent.com.
          </p>
          <input
            type="password"
            placeholder="ghp_… or github_pat_…"
            value={gh.token}
            onInput={(e) => setGh("token", e.currentTarget.value)}
            onChange={save}
          />
        </div>

        <div class="pt-form-actions">
          <button type="button" class="pt-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
