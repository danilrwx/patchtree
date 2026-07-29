// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import { render } from "solid-js/web";
import { createSignal, For, onMount } from "solid-js";

type Row = { host: string; token: string };

function App() {
  const [rows, setRows] = createSignal<Row[]>([]);
  const [gh, setGh] = createSignal("");

  const save = async () => {
    const gitlabs: Record<string, { token: string }> = {};
    for (const r of rows()) {
      const h = r.host.trim();
      if (h && h !== "github.com") gitlabs[h] = { token: r.token.trim() };
    }
    if (gh().trim()) gitlabs["github.com"] = { token: gh().trim() };
    await chrome.storage.local.set({ gitlabs });
  };

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { host: "", token: "" }]);
  const removeRow = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    save();
  };

  onMount(async () => {
    let { gitlabs } = await chrome.storage.local.get("gitlabs");
    if (!gitlabs) ({ gitlabs = {} } = await chrome.storage.sync.get("gitlabs"));
    setGh(gitlabs["github.com"]?.token || "");
    const rest: Row[] = Object.entries(gitlabs as Record<string, { token?: string }>)
      .filter(([host]) => host !== "github.com")
      .map(([host, v]) => ({ host, token: v.token || "" }));
    setRows(rest.length ? rest : [{ host: "", token: "" }]);
  });

  return (
    <>
      <h3>GitLab instances</h3>
      <p>
        Host → personal access token with the <code>api</code> scope. Enables comments, approve and
        request-changes on <code>.diff</code> pages of that host.
      </p>
      <table>
        <tbody>
          <tr>
            <th>Host</th>
            <th>Token</th>
            <th />
          </tr>
          <For each={rows()}>
            {(r, i) => (
              <tr>
                <td>
                  <input
                    placeholder="gitlab.example.com"
                    value={r.host}
                    onInput={(e) => setRow(i(), { host: e.currentTarget.value })}
                    onChange={save}
                  />
                </td>
                <td>
                  <input
                    type="password"
                    placeholder="glpat-…"
                    value={r.token}
                    onInput={(e) => setRow(i(), { token: e.currentTarget.value })}
                    onChange={save}
                  />
                </td>
                <td>
                  <button onClick={() => removeRow(i())}>✕</button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <button onClick={addRow}>Add host</button>

      <h3>GitHub</h3>
      <p>
        Classic personal access token with the <code>repo</code> scope. Used on{" "}
        <code>github.com</code> and <code>patch-diff.githubusercontent.com</code> pull request diffs.
      </p>
      <table>
        <tbody>
          <tr>
            <td style="width:30%">Token</td>
            <td>
              <input
                type="password"
                placeholder="ghp_… or github_pat_…"
                value={gh()}
                onInput={(e) => setGh(e.currentTarget.value)}
                onChange={save}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

render(() => <App />, document.getElementById("root")!);
