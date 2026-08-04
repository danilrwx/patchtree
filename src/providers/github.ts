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

import type { Provider, Note, Refs, SuggestionApply } from "../types";
import { tokenFor, throwIfBad, cachedFetch, imageDataUrl, blobLinks } from "./shared";

export function github(owner: string, repo: string, num: string): Provider {
  const API = "https://api.github.com";
  const base = `/repos/${owner}/${repo}`;
  let markRefs: () => void = () => {};
  const refsReady = new Promise<void>((r) => (markRefs = r));
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
    await throwIfBad(resp);
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
          startLine: c0.start_line ?? null,
        },
        notes: list.map((c) => noteN(c, "line")),
      });
    }
    return out;
  }

  const THREADS_GQL = `query($owner:String!,$repo:String!,$num:Int!){
    repository(owner:$owner,name:$repo){ pullRequest(number:$num){
      reviewThreads(first:100){ nodes{
        id isResolved path line startLine diffSide
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
  const links = blobLinks(`https://github.com/${owner}/${repo}/blob`, () => refs);

  const P: Provider = {
    kind: "github",
    can: { resolve: true, drafts: false, applySuggestion: true, whitespace: false },
    token: null,
    tokenHint: "no GitHub token — add one in ⚙ → Access tokens (classic or fine-grained PAT)",
    setRefs: (i) => {
      refs = i;
      markRefs();
    },
    init: async () => {
      P.token = await tokenFor("github.com");
    },
    me: () => api("/user").then((u) => ({ id: u.id, name: u.login })),
    info: async () => {
      const pr = await api(`${base}/pulls/${num}`);
      // Actions report through check-runs while older CI uses commit statuses;
      // a PR built by Actions alone has total_count 0 on the status endpoint, so
      // looking only there reported "no CI" for most repositories today
      let ci = null;
      try {
        const [s, runs] = await Promise.all([
          api(`${base}/commits/${pr.head.sha}/status`).catch(() => ({ total_count: 0 })),
          api(`${base}/commits/${pr.head.sha}/check-runs`).catch(() => ({ check_runs: [] })),
        ]);
        const states: string[] = [];
        if (s.total_count > 0) states.push(s.state === "failure" ? "failed" : s.state);
        for (const r of runs.check_runs || [])
          states.push(r.status === "completed" ? r.conclusion : r.status);
        if (states.length)
          ci = {
            state: states.some((x) => ["failed", "failure", "timed_out", "cancelled"].includes(x))
              ? "failed"
              : states.some((x) => ["pending", "queued", "in_progress"].includes(x))
                ? "pending"
                : states.every((x) => ["success", "neutral", "skipped"].includes(x))
                  ? "success"
                  : "pending",
            url: `https://github.com/${owner}/${repo}/pull/${num}/checks`,
            ref: pr.head.sha,
          };
      } catch {
        // checks may be unavailable without a token
      }
      return {
        title: `#${num} ${pr.title}`,
        webUrl: pr.html_url,
        state: pr.merged ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open",
        author: pr.user?.login,
        createdAt: pr.created_at,
        description: pr.body,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        startSha: pr.base.sha,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
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
                // first line of a multi-line comment; the suggestion range on
                // GitHub comes from this (start_line..line), not the fence
                startLine: th.startLine ?? null,
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
    // check runs cover Actions and most apps; the older commit statuses cover
    // external CI that never migrated, so both are listed
    ciJobs: async (ci) => {
      if (!ci.ref) return [];
      const [runs, statuses] = await Promise.all([
        api(`${base}/commits/${ci.ref}/check-runs`).catch(() => ({ check_runs: [] })),
        api(`${base}/commits/${ci.ref}/status`).catch(() => ({ statuses: [] })),
      ]);
      const jobs: any[] = (runs.check_runs || []).map((r: any) => ({
        name: r.name,
        // a queued run has no conclusion yet; its status is the honest answer
        state: r.conclusion || r.status,
        url: r.html_url,
      }));
      for (const s of statuses.statuses || [])
        jobs.push({
          name: s.context,
          state: s.state === "failure" ? "failed" : s.state,
          url: s.target_url,
        });
      return jobs;
    },
    commitDiff: async (sha) => {
      const r = await chrome.runtime.sendMessage({
        type: "fetchText",
        url: `https://github.com/${owner}/${repo}/commit/${sha}.diff`,
      });
      if (!r?.ok) throw new Error(r?.text || "fetch failed");
      return r.text;
    },
    fetchFile: (path) =>
      cachedFetch(fileCache, path, () =>
        api(
          `${base}/contents/${encodeURI(path)}?ref=${refs?.headSha || "HEAD"}`,
          {},
          "application/vnd.github.raw+json"
        ).then((t) => t.split("\n"))
      ),
    markdown: (text) =>
      api(
        "/markdown",
        {
          method: "POST",
          body: JSON.stringify({ text, mode: "gfm", context: `${owner}/${repo}` }),
        },
        "text/html"
      ),
    permalink: links.permalink,
    blobUrl: links.blobUrl,
    imageDataUrl: (path, side) =>
      imageDataUrl(path, side, refsReady, () => refs, async (ref) => {
        const f = await api(`${base}/contents/${encodeURI(path)}?ref=${ref}`);
        return f?.content ? String(f.content).replace(/\n/g, "") : null;
      }),
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
