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

import type {
  Provider,
  Note,
  Refs,
  LineAnchor,
  SuggestionApply,
  Side,
} from "./types";

declare global {
  interface Window {
    ptProvider: Provider | null;
  }
}

// Review providers: one normalized interface, two implementations.
window.ptProvider = (() => {
  // tokens live in storage.local (never synced to the browser vendor's cloud);
  // migrate any previously sync-stored tokens on first read
  async function readTokens(): Promise<Record<string, { token?: string }>> {
    const local = await chrome.storage.local.get("gitlabs");
    if (local.gitlabs) return local.gitlabs;
    const { gitlabs } = await chrome.storage.sync.get("gitlabs");
    if (gitlabs) {
      await chrome.storage.local.set({ gitlabs });
      chrome.storage.sync.remove("gitlabs");
      return gitlabs;
    }
    return {};
  }
  const tokenFor = (host: string) => readTokens().then((g) => g[host]?.token || null);

  function gitlab(projectPath: string, iid: string): Provider {
    const project = encodeURIComponent(projectPath);
    let refs: Refs | null = null;

    const headers = (extra: Record<string, string> = {}): Record<string, string> => {
      const h = { ...extra };
      if (P.token) h["PRIVATE-TOKEN"] = P.token;
      return h;
    };

    async function api(path: string, opts: RequestInit = {}): Promise<any> {
      const resp = await fetch(`${location.origin}/api/v4${path}`, {
        cache: "no-store",
        ...opts,
        headers: headers(opts.body ? { "Content-Type": "application/json" } : {}),
      });
      if (!resp.ok)
        throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 200));
      return resp.status === 204 ? null : resp.json();
    }

    async function apiPaged(path: string): Promise<any[]> {
      const out: any[] = [];
      let page = 1;
      while (page) {
        const resp = await fetch(`${location.origin}/api/v4${path}&per_page=100&page=${page}`, {
          headers: headers(),
          cache: "no-store",
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        out.push(...(await resp.json()));
        page = +(resp.headers.get("x-next-page") || 0) || 0;
      }
      return out;
    }

    async function graphql(query: string, variables: any): Promise<any> {
      const resp = await fetch(`${location.origin}/api/graphql`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
      const data = await resp.json();
      const errors =
        data.errors?.map((e: any) => e.message) || data.data?.mergeRequestRequestChanges?.errors;
      if (errors?.length) throw new Error(errors.join("; ").slice(0, 200));
      return data.data;
    }

    async function sha1hex(s: string): Promise<string> {
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    const noteN = (n: any): Note => ({
      id: n.id,
      kind: "line",
      author: n.author?.name || "?",
      authorId: n.author?.id,
      createdAt: n.created_at,
      body: n.body || "",
      resolved: !!n.resolved,
      suggestions: n.suggestions || null,
    });

    async function position(p: LineAnchor): Promise<any> {
      const pos: any = {
        base_sha: refs!.baseSha,
        start_sha: refs!.startSha,
        head_sha: refs!.headSha,
        position_type: "text",
        new_path: p.path,
        old_path: p.oldPath || p.path,
      };
      // a paired replacement row carries both numbers pointing at DIFFERENT
      // lines — only context rows may send both sides
      if (p.ctx) {
        if (p.endNew) pos.new_line = p.endNew;
        if (p.endOld) pos.old_line = p.endOld;
      } else if (p.side === "old") pos.old_line = p.endOld;
      else pos.new_line = p.endNew;
      if (p.multiline) {
        const sha = await sha1hex(p.path);
        const lc = (r: any) => `${sha}_${r.codeOld}_${r.codeNew}`;
        const typ = (r: any) => (r.ctx ? null : p.side === "new" ? "new" : "old");
        pos.line_range = {
          start: { line_code: lc(p.start), type: typ(p.start) },
          end: { line_code: lc(p.end), type: typ(p.end) },
        };
      }
      return pos;
    }

    const fileCache = new Map<string, Promise<string[]>>();

    const P: Provider = {
      kind: "gitlab",
      can: { resolve: true, drafts: true, applySuggestion: true, whitespace: true },
      token: null,
      tokenHint: `no token for ${location.host} — add one in ⚙ → Access tokens to review`,
      setRefs: (i) => {
        refs = i;
      },
      init: async () => {
        P.token = await tokenFor(location.host);
      },
      me: () => api("/user").then((u) => ({ id: u.id, name: u.name })),
      info: async () => {
        const mr = await api(`/projects/${project}/merge_requests/${iid}`);
        return {
          title: `!${iid} ${mr.title}`,
          headSha: mr.diff_refs?.head_sha,
          baseSha: mr.diff_refs?.base_sha,
          startSha: mr.diff_refs?.start_sha,
          ci: mr.head_pipeline
            ? { state: mr.head_pipeline.status, url: mr.head_pipeline.web_url }
            : null,
          conflicts: !!mr.has_conflicts,
        };
      },
      threads: async () => {
        const ds = await apiPaged(
          `/projects/${project}/merge_requests/${iid}/discussions?order_by=created_at`
        );
        const out = [];
        for (const d of ds) {
          const notes = (d.notes || []).filter((n: any) => !n.system);
          if (!notes.length) continue;
          const pos = notes[0].position;
          const first = notes.find((n: any) => n.resolvable);
          const t: any = {
            id: d.id,
            resolvable: !!first,
            resolved: first ? !!first.resolved : false,
            general: pos?.position_type !== "text",
            pos: null,
            notes: notes.map(noteN),
          };
          if (!t.general)
            t.pos = {
              path: pos.new_path || pos.old_path,
              oldPath: pos.old_path,
              side: pos.new_line ? "new" : "old",
              oldLine: pos.old_line,
              newLine: pos.new_line,
            };
          out.push(t);
        }
        return out;
      },
      postThread: async (p, body) => {
        const d = await api(`/projects/${project}/merge_requests/${iid}/discussions`, {
          method: "POST",
          body: JSON.stringify({ body, position: await position(p) }),
        });
        return (d.notes || []).map(noteN);
      },
      reply: async (t, body) =>
        noteN(
          await api(`/projects/${project}/merge_requests/${iid}/discussions/${t.id}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
          })
        ),
      editNote: async (note, body) =>
        (
          await api(`/projects/${project}/merge_requests/${iid}/notes/${note.id}`, {
            method: "PUT",
            body: JSON.stringify({ body }),
          })
        ).body,
      deleteNote: (note) =>
        api(`/projects/${project}/merge_requests/${iid}/notes/${note.id}`, { method: "DELETE" }),
      resolveThread: (t, v) =>
        api(`/projects/${project}/merge_requests/${iid}/discussions/${t.id}?resolved=${v}`, {
          method: "PUT",
        }),
      review: async ({ body, action }) => {
        if (body)
          await api(`/projects/${project}/merge_requests/${iid}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
          });
        if (action === "approve")
          await api(`/projects/${project}/merge_requests/${iid}/approve`, { method: "POST" });
        else if (action === "unapprove")
          await api(`/projects/${project}/merge_requests/${iid}/unapprove`, { method: "POST" });
        else if (action === "request")
          await graphql(
            `mutation($p: ID!, $iid: String!) {
               mergeRequestRequestChanges(input: {projectPath: $p, iid: $iid}) { errors }
             }`,
            { p: projectPath, iid }
          );
      },
      approvedByMe: async (meId) => {
        const appr = await api(`/projects/${project}/merge_requests/${iid}/approvals`);
        return !!appr.approved_by?.some((a: any) => a.user?.id === meId);
      },
      commits: () =>
        apiPaged(`/projects/${project}/merge_requests/${iid}/commits?`).then((cs) =>
          cs.map((c) => ({ sha: c.id, short: c.short_id, title: c.title }))
        ),
      commitDiff: async (sha) => {
        const r = await fetch(`${location.origin}/${projectPath}/-/commit/${sha}.diff`);
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      },
      fetchFile: (path) => {
        if (!fileCache.has(path))
          fileCache.set(
            path,
            (async () => {
              const r = await fetch(
                `${location.origin}/api/v4/projects/${project}/repository/files/${encodeURIComponent(path)}/raw?ref=${refs?.headSha || "HEAD"}`,
                { headers: headers() }
              );
              if (!r.ok) throw new Error(`file fetch: ${r.status}`);
              return (await r.text()).split("\n");
            })().catch((e) => {
              fileCache.delete(path);
              throw e;
            })
          );
        return fileCache.get(path)!;
      },
      markdown: async (text) =>
        (
          await api("/markdown", {
            method: "POST",
            body: JSON.stringify({ text, gfm: true, project: projectPath }),
          })
        ).html,
      whitespaceDiff: async () => {
        const r = await fetch(`${location.href}?w=1`);
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      },
      permalink: (path, side, line) =>
        refs
          ? `${location.origin}/${projectPath}/-/blob/${side === "old" ? refs.baseSha : refs.headSha}/${encodeURI(path)}#L${line}`
          : null,
      blobUrl: (path) =>
        refs ? `${location.origin}/${projectPath}/-/blob/${refs.headSha}/${encodeURI(path)}` : null,
      applySuggestion: (sug) =>
        api(`/projects/${project}/suggestions/${sug.id}/apply`, { method: "PUT" }),
      drafts: async () =>
        (await apiPaged(`/projects/${project}/merge_requests/${iid}/draft_notes?`)).map((d) => ({
          id: d.id,
          body: d.note,
          pos:
            d.position?.position_type === "text"
              ? {
                  path: d.position.new_path || d.position.old_path,
                  oldPath: d.position.old_path,
                  side: (d.position.new_line ? "new" : "old") as Side,
                  oldLine: d.position.old_line,
                  newLine: d.position.new_line,
                }
              : null,
        })),
      postDraft: async (p, body, replyTo) => {
        const payload = replyTo
          ? { note: body, in_reply_to_discussion_id: replyTo }
          : { note: body, position: await position(p) };
        const d = await api(`/projects/${project}/merge_requests/${iid}/draft_notes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        return { id: d.id, body: d.note };
      },
      deleteDraft: (d) =>
        api(`/projects/${project}/merge_requests/${iid}/draft_notes/${d.id}`, { method: "DELETE" }),
      publishDrafts: () =>
        api(`/projects/${project}/merge_requests/${iid}/draft_notes/bulk_publish`, {
          method: "PUT",
        }),
    };
    return P;
  }

  function github(owner: string, repo: string, num: string): Provider {
    const API = "https://api.github.com";
    const base = `/repos/${owner}/${repo}`;
    let refs: Refs | null = null;

    const headers = (extra: Record<string, string> = {}): Record<string, string> => {
      const h: Record<string, string> = { Accept: "application/vnd.github+json", ...extra };
      if (P.token) h.Authorization = `Bearer ${P.token}`;
      return h;
    };

    async function graphql(query: string, variables: any): Promise<any> {
      const resp = await fetch(`${API}/graphql`, {
        method: "POST",
        cache: "no-store",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
      const data = await resp.json();
      if (data.errors?.length)
        throw new Error(
          data.errors
            .map((e: any) => e.message)
            .join("; ")
            .slice(0, 200)
        );
      return data.data;
    }

    async function api(path: string, opts: RequestInit = {}, accept?: string): Promise<any> {
      const resp = await fetch(`${API}${path}`, {
        cache: "no-store",
        ...opts,
        headers: headers(accept ? { Accept: accept } : {}),
      });
      if (!resp.ok)
        throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 200));
      if (resp.status === 204) return null;
      return accept ? resp.text() : resp.json();
    }

    async function apiPaged(path: string): Promise<any[]> {
      const out: any[] = [];
      let page = 1;
      for (;;) {
        const batch = await api(`${path}&per_page=100&page=${page}`);
        out.push(...batch);
        if (batch.length < 100) return out;
        page++;
      }
    }

    const noteN = (c: any, kind: "line" | "issue"): Note => ({
      id: c.id,
      kind,
      author: c.user?.login || "?",
      authorId: c.user?.id,
      createdAt: c.created_at,
      body: c.body || "",
      resolved: false,
      suggestions: null,
    });

    // REST fallback used when there is no token (GraphQL needs auth); read-only
    async function threadsRest(): Promise<any[]> {
      const cs = await apiPaged(`${base}/pulls/${num}/comments?`);
      const roots = new Map<any, any[]>();
      for (const c of cs) {
        const root = c.in_reply_to_id || c.id;
        if (!roots.has(root)) roots.set(root, []);
        roots.get(root)!.push(c);
      }
      const out = [];
      for (const [rootId, list] of roots) {
        const c0 = list[0];
        if (c0.line == null) continue;
        out.push({
          id: rootId,
          replyToId: rootId,
          general: false,
          resolvable: false,
          resolved: false,
          pos: {
            path: c0.path,
            oldPath: c0.path,
            side: c0.side === "LEFT" ? "old" : "new",
            oldLine: c0.side === "LEFT" ? c0.line : null,
            newLine: c0.side === "LEFT" ? null : c0.line,
          },
          notes: list.map((c) => noteN(c, "line")),
        });
      }
      return out;
    }

    const THREADS_GQL = `query($owner:String!,$repo:String!,$num:Int!){
      repository(owner:$owner,name:$repo){ pullRequest(number:$num){
        reviewThreads(first:100){ nodes{
          id isResolved path line diffSide
          comments(first:100){ nodes{
            databaseId body createdAt
            author{ login ... on User { databaseId } }
          }}
        }}
      }}}`;

    async function myReviews(): Promise<any[]> {
      const meU = await P.me().catch(() => null);
      if (!meU) return [];
      const rs = await apiPaged(`${base}/pulls/${num}/reviews?`);
      return rs.filter((r) => r.user?.id === meU.id);
    }

    const fileCache = new Map<string, Promise<string[]>>();

    const P: Provider = {
      kind: "github",
      can: { resolve: true, drafts: false, applySuggestion: true, whitespace: false },
      token: null,
      tokenHint: "no GitHub token — add one in ⚙ → Access tokens (classic or fine-grained PAT)",
      setRefs: (i) => {
        refs = i;
      },
      init: async () => {
        P.token = await tokenFor("github.com");
      },
      me: () => api("/user").then((u) => ({ id: u.id, name: u.login })),
      info: async () => {
        const pr = await api(`${base}/pulls/${num}`);
        let ci = null;
        try {
          const s = await api(`${base}/commits/${pr.head.sha}/status`);
          if (s.total_count > 0)
            ci = {
              state: s.state === "failure" ? "failed" : s.state,
              url: `https://github.com/${owner}/${repo}/pull/${num}/checks`,
            };
        } catch {
          // status may be unavailable without token
        }
        return {
          title: `#${num} ${pr.title}`,
          headSha: pr.head.sha,
          baseSha: pr.base.sha,
          startSha: pr.base.sha,
          ci,
          conflicts: pr.mergeable === false,
        };
      },
      threads: async () => {
        const out: any[] = [];
        if (P.token) {
          try {
            const d = await graphql(THREADS_GQL, { owner, repo, num: +num });
            for (const th of d.repository.pullRequest.reviewThreads.nodes) {
              const comments = th.comments.nodes;
              if (!comments.length || th.line == null) continue;
              const side = th.diffSide === "LEFT" ? "old" : "new";
              out.push({
                id: th.id,
                replyToId: comments[0].databaseId,
                general: false,
                resolvable: true,
                resolved: th.isResolved,
                pos: {
                  path: th.path,
                  oldPath: th.path,
                  side,
                  oldLine: side === "old" ? th.line : null,
                  newLine: side === "new" ? th.line : null,
                },
                notes: comments.map((c: any) => ({
                  id: c.databaseId,
                  kind: "line",
                  author: c.author?.login || "?",
                  authorId: c.author?.databaseId,
                  createdAt: c.createdAt,
                  body: c.body || "",
                  resolved: th.isResolved,
                  suggestions: null,
                })),
              });
            }
          } catch {
            out.push(...(await threadsRest()));
          }
        } else {
          out.push(...(await threadsRest()));
        }
        const ics = await apiPaged(`${base}/issues/${num}/comments?`);
        if (ics.length)
          out.push({
            id: "__issue",
            general: true,
            resolvable: false,
            resolved: false,
            pos: null,
            notes: ics.map((c) => noteN(c, "issue")),
          });
        return out;
      },
      resolveThread: (t, v) =>
        graphql(
          v
            ? `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}`
            : `mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{isResolved}}}`,
          { id: t.id }
        ),
      postThread: async (p, body) => {
        const payload: any = {
          body,
          commit_id: refs!.headSha,
          path: p.path,
          line: p.side === "old" ? p.endOld : p.endNew,
          side: p.side === "old" ? "LEFT" : "RIGHT",
        };
        if (p.multiline) {
          payload.start_line = p.side === "old" ? p.start!.old : p.start!.new;
          payload.start_side = payload.side;
        }
        const c = await api(`${base}/pulls/${num}/comments`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        return [noteN(c, "line")];
      },
      reply: async (t, body) => {
        if (t.general)
          return noteN(
            await api(`${base}/issues/${num}/comments`, {
              method: "POST",
              body: JSON.stringify({ body }),
            }),
            "issue"
          );
        return noteN(
          await api(`${base}/pulls/${num}/comments/${t.replyToId || t.id}/replies`, {
            method: "POST",
            body: JSON.stringify({ body }),
          }),
          "line"
        );
      },
      editNote: async (note, body) => {
        const path =
          note.kind === "issue"
            ? `${base}/issues/comments/${note.id}`
            : `${base}/pulls/comments/${note.id}`;
        return (await api(path, { method: "PATCH", body: JSON.stringify({ body }) })).body;
      },
      deleteNote: (note) =>
        api(
          note.kind === "issue"
            ? `${base}/issues/comments/${note.id}`
            : `${base}/pulls/comments/${note.id}`,
          { method: "DELETE" }
        ),
      review: async ({ body, action }) => {
        if (action === "unapprove") {
          const mine = await myReviews();
          const approved = mine.filter((r) => r.state === "APPROVED").pop();
          if (approved)
            await api(`${base}/pulls/${num}/reviews/${approved.id}/dismissals`, {
              method: "PUT",
              body: JSON.stringify({ message: body || "dismissed" }),
            });
          return;
        }
        const event =
          action === "approve" ? "APPROVE" : action === "request" ? "REQUEST_CHANGES" : "COMMENT";
        if (event === "COMMENT" && !body) return;
        await api(`${base}/pulls/${num}/reviews`, {
          method: "POST",
          body: JSON.stringify({ body: body || "", event }),
        });
      },
      approvedByMe: async () => {
        const mine = await myReviews();
        const last = mine
          .filter((r) => ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state))
          .pop();
        return last?.state === "APPROVED";
      },
      commits: () =>
        apiPaged(`${base}/pulls/${num}/commits?`).then((cs) =>
          cs.map((c) => ({
            sha: c.sha,
            short: c.sha.slice(0, 8),
            title: (c.commit?.message || "").split("\n")[0],
          }))
        ),
      commitDiff: async (sha) => {
        const r = await chrome.runtime.sendMessage({
          type: "fetchText",
          url: `https://github.com/${owner}/${repo}/commit/${sha}.diff`,
        });
        if (!r?.ok) throw new Error(r?.text || "fetch failed");
        return r.text;
      },
      fetchFile: (path) => {
        if (!fileCache.has(path))
          fileCache.set(
            path,
            api(
              `${base}/contents/${encodeURI(path)}?ref=${refs?.headSha || "HEAD"}`,
              {},
              "application/vnd.github.raw+json"
            )
              .then((t) => t.split("\n"))
              .catch((e) => {
                fileCache.delete(path);
                throw e;
              })
          );
        return fileCache.get(path)!;
      },
      markdown: (text) =>
        api(
          "/markdown",
          {
            method: "POST",
            body: JSON.stringify({ text, mode: "gfm", context: `${owner}/${repo}` }),
          },
          "text/html"
        ),
      permalink: (path, side, line) =>
        refs
          ? `https://github.com/${owner}/${repo}/blob/${side === "old" ? refs.baseSha : refs.headSha}/${encodeURI(path)}#L${line}`
          : null,
      blobUrl: (path) =>
        refs ? `https://github.com/${owner}/${repo}/blob/${refs.headSha}/${encodeURI(path)}` : null,
      // GitHub has no single-suggestion apply endpoint — commit the replacement
      // to the PR head branch (like GitLab's apply does to the MR source branch).
      applySuggestion: async (desc: SuggestionApply) => {
        const pr = await api(`${base}/pulls/${num}`);
        const branch = pr.head.ref;
        const [ho, hr] = pr.head.repo.full_name.split("/");
        const hbase = `/repos/${ho}/${hr}`;
        const file = await api(`${hbase}/contents/${encodeURI(desc.path)}?ref=${branch}`);
        const decode = (b64: string) => decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
        const encode = (s: string) => btoa(unescape(encodeURIComponent(s)));
        const lines = decode(file.content).split("\n");
        lines.splice(desc.startLine - 1, desc.endLine - desc.startLine + 1, ...desc.text.split("\n"));
        await api(`${hbase}/contents/${encodeURI(desc.path)}`, {
          method: "PUT",
          body: JSON.stringify({
            message: `Apply suggestion to ${desc.path}`,
            content: encode(lines.join("\n")),
            sha: file.sha,
            branch,
          }),
        });
      },
    };
    return P;
  }

  const host = location.host;
  const path = location.pathname;
  let m = /^\/(.+)\/-\/merge_requests\/(\d+)\.(?:diff|patch)$/.exec(path);
  if (m) return gitlab(m[1], m[2]);
  if (host === "patch-diff.githubusercontent.com") {
    m = /^\/raw\/([^/]+)\/([^/]+)\/pull\/(\d+)\.(?:diff|patch)$/.exec(path);
    if (m) return github(m[1], m[2], m[3]);
  }
  if (host === "github.com") {
    m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\.(?:diff|patch)$/.exec(path);
    if (m) return github(m[1], m[2], m[3]);
  }
  return null;
})();
