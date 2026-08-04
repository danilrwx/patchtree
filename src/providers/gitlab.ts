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

import type { Provider, Note, Refs, LineAnchor, Side } from "../types";
import { tokenFor, throwIfBad, cachedFetch, imageDataUrl, blobLinks } from "./shared";

export function gitlab(projectPath: string, iid: string): Provider {
  const project = encodeURIComponent(projectPath);
  let refs: Refs | null = null;
  // resolves once setRefs lands the base/head shas, so image previews (which
  // mount before the review layer fetches refs) can wait for them
  let markRefs: () => void = () => {};
  const refsReady = new Promise<void>((r) => (markRefs = r));

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
    await throwIfBad(resp);
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
  const links = blobLinks(`${location.origin}/${projectPath}/-/blob`, () => refs);

  const P: Provider = {
    kind: "gitlab",
    can: { resolve: true, drafts: true, applySuggestion: true, whitespace: true },
    token: null,
    tokenHint: `no token for ${location.host} — add one in ⚙ → Access tokens to review`,
    setRefs: (i) => {
      refs = i;
      markRefs();
    },
    init: async () => {
      P.token = await tokenFor(location.host);
    },
    me: () => api("/user").then((u) => ({ id: u.id, name: u.name })),
    info: async () => {
      const mr = await api(`/projects/${project}/merge_requests/${iid}`);
      return {
        title: `!${iid} ${mr.title}`,
        webUrl: mr.web_url,
        state: mr.draft
          ? "draft"
          : mr.state === "merged"
            ? "merged"
            : mr.state === "closed"
              ? "closed"
              : "open",
        author: mr.author?.name || mr.author?.username,
        createdAt: mr.created_at,
        description: mr.description,
        headSha: mr.diff_refs?.head_sha,
        baseSha: mr.diff_refs?.base_sha,
        startSha: mr.diff_refs?.start_sha,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
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
    fetchFile: (path) =>
      cachedFetch(fileCache, path, async () => {
        const r = await fetch(
          `${location.origin}/api/v4/projects/${project}/repository/files/${encodeURIComponent(path)}/raw?ref=${refs?.headSha || "HEAD"}`,
          { headers: headers() }
        );
        if (!r.ok) throw new Error(`file fetch: ${r.status}`);
        return (await r.text()).split("\n");
      }),
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
    permalink: links.permalink,
    blobUrl: links.blobUrl,
    imageDataUrl: (path, side) =>
      imageDataUrl(path, side, refsReady, () => refs, async (ref) => {
        const f = await api(
          `/projects/${project}/repository/files/${encodeURIComponent(path)}?ref=${ref}`
        );
        return f?.content ?? null;
      }),
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
    // bulk_publish is a POST; a PUT here is routed to /draft_notes/:id instead
    // and rejected with "draft_note_id is invalid"
    publishDrafts: () =>
      api(`/projects/${project}/merge_requests/${iid}/draft_notes/bulk_publish`, {
        method: "POST",
      }),
  };
  return P;
}
