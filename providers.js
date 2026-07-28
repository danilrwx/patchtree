// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
"use strict";

// Review providers: one normalized interface, two implementations.
// Threads: { id, general, resolvable, resolved, pos: {path, oldPath, side, oldLine, newLine}|null, notes: [note] }
// Note: { id, kind, author, authorId, createdAt, body, resolved, suggestions }
window.ptProvider = (() => {
  const tokenFor = (host) =>
    chrome.storage.sync
      .get("gitlabs")
      .then(({ gitlabs = {} }) => gitlabs[host]?.token || null);

  function gitlab(projectPath, iid) {
    const project = encodeURIComponent(projectPath);
    let refs = null;

    const P = {
      kind: "gitlab",
      can: { resolve: true, drafts: true, applySuggestion: true, whitespace: true },
      token: null,
      tokenHint: `no token for ${location.host} — add one in ⚙ → Access tokens to review`,
      setRefs: (i) => (refs = i),
    };

    const headers = (extra = {}) => {
      const h = { ...extra };
      if (P.token) h["PRIVATE-TOKEN"] = P.token;
      return h;
    };

    async function api(path, opts = {}) {
      const resp = await fetch(`${location.origin}/api/v4${path}`, {
        ...opts,
        headers: headers(opts.body ? { "Content-Type": "application/json" } : {}),
      });
      if (!resp.ok)
        throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 200));
      return resp.status === 204 ? null : resp.json();
    }

    async function apiPaged(path) {
      const out = [];
      let page = 1;
      while (page) {
        const resp = await fetch(
          `${location.origin}/api/v4${path}&per_page=100&page=${page}`,
          { headers: headers() }
        );
        if (!resp.ok) throw new Error(`${resp.status}`);
        out.push(...(await resp.json()));
        page = +resp.headers.get("x-next-page") || 0;
      }
      return out;
    }

    async function graphql(query, variables) {
      const resp = await fetch(`${location.origin}/api/graphql`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
      const data = await resp.json();
      const errors =
        data.errors?.map((e) => e.message) || data.data?.mergeRequestRequestChanges?.errors;
      if (errors?.length) throw new Error(errors.join("; ").slice(0, 200));
      return data.data;
    }

    async function sha1hex(s) {
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    const noteN = (n) => ({
      id: n.id,
      kind: "line",
      author: n.author?.name || "?",
      authorId: n.author?.id,
      createdAt: n.created_at,
      body: n.body || "",
      resolved: !!n.resolved,
      suggestions: n.suggestions || null,
    });

    async function position(p) {
      const pos = {
        base_sha: refs.baseSha,
        start_sha: refs.startSha,
        head_sha: refs.headSha,
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
        const lc = (r) => `${sha}_${r.codeOld}_${r.codeNew}`;
        const typ = (r) => (r.ctx ? null : p.side === "new" ? "new" : "old");
        pos.line_range = {
          start: { line_code: lc(p.start), type: typ(p.start) },
          end: { line_code: lc(p.end), type: typ(p.end) },
        };
      }
      return pos;
    }

    P.init = async () => {
      P.token = await tokenFor(location.host);
    };
    P.me = () => api("/user").then((u) => ({ id: u.id, name: u.name }));
    P.info = async () => {
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
    };
    P.threads = async () => {
      const ds = await apiPaged(
        `/projects/${project}/merge_requests/${iid}/discussions?order_by=created_at`
      );
      const out = [];
      for (const d of ds) {
        const notes = (d.notes || []).filter((n) => !n.system);
        if (!notes.length) continue;
        const pos = notes[0].position;
        const first = notes.find((n) => n.resolvable);
        const t = {
          id: d.id,
          resolvable: !!first,
          resolved: first ? !!first.resolved : false,
          general: !pos || pos.position_type !== "text",
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
    };
    P.postThread = async (p, body) => {
      const d = await api(`/projects/${project}/merge_requests/${iid}/discussions`, {
        method: "POST",
        body: JSON.stringify({ body, position: await position(p) }),
      });
      return (d.notes || []).map(noteN);
    };
    P.reply = async (t, body) =>
      noteN(
        await api(`/projects/${project}/merge_requests/${iid}/discussions/${t.id}/notes`, {
          method: "POST",
          body: JSON.stringify({ body }),
        })
      );
    P.editNote = async (note, body) =>
      (
        await api(`/projects/${project}/merge_requests/${iid}/notes/${note.id}`, {
          method: "PUT",
          body: JSON.stringify({ body }),
        })
      ).body;
    P.deleteNote = (note) =>
      api(`/projects/${project}/merge_requests/${iid}/notes/${note.id}`, { method: "DELETE" });
    P.resolveThread = (t, v) =>
      api(`/projects/${project}/merge_requests/${iid}/discussions/${t.id}?resolved=${v}`, {
        method: "PUT",
      });
    P.review = async ({ body, action }) => {
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
    };
    P.approvedByMe = async (meId) => {
      const appr = await api(`/projects/${project}/merge_requests/${iid}/approvals`);
      return !!appr.approved_by?.some((a) => a.user?.id === meId);
    };
    P.commits = () =>
      apiPaged(`/projects/${project}/merge_requests/${iid}/commits?`).then((cs) =>
        cs.map((c) => ({ sha: c.id, short: c.short_id, title: c.title }))
      );
    P.commitDiff = async (sha) => {
      const r = await fetch(`${location.origin}/${projectPath}/-/commit/${sha}.diff`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.text();
    };
    const fileCache = new Map();
    P.fetchFile = (path) => {
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
      return fileCache.get(path);
    };
    P.markdown = async (text) =>
      (
        await api("/markdown", {
          method: "POST",
          body: JSON.stringify({ text, gfm: true, project: projectPath }),
        })
      ).html;
    P.whitespaceDiff = async () => {
      const r = await fetch(`${location.href}?w=1`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.text();
    };
    P.permalink = (path, side, line) =>
      refs
        ? `${location.origin}/${projectPath}/-/blob/${side === "old" ? refs.baseSha : refs.headSha}/${encodeURI(path)}#L${line}`
        : null;
    P.blobUrl = (path) =>
      refs ? `${location.origin}/${projectPath}/-/blob/${refs.headSha}/${encodeURI(path)}` : null;
    P.applySuggestion = (sug) =>
      api(`/projects/${project}/suggestions/${sug.id}/apply`, { method: "PUT" });
    P.drafts = async () =>
      (await apiPaged(`/projects/${project}/merge_requests/${iid}/draft_notes?`)).map((d) => ({
        id: d.id,
        body: d.note,
        pos:
          d.position?.position_type === "text"
            ? {
                path: d.position.new_path || d.position.old_path,
                side: d.position.new_line ? "new" : "old",
                oldLine: d.position.old_line,
                newLine: d.position.new_line,
              }
            : null,
      }));
    P.postDraft = async (p, body, replyTo) => {
      const payload = replyTo
        ? { note: body, in_reply_to_discussion_id: replyTo }
        : { note: body, position: await position(p) };
      const d = await api(`/projects/${project}/merge_requests/${iid}/draft_notes`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return { id: d.id, body: d.note };
    };
    P.deleteDraft = (d) =>
      api(`/projects/${project}/merge_requests/${iid}/draft_notes/${d.id}`, { method: "DELETE" });
    P.publishDrafts = () =>
      api(`/projects/${project}/merge_requests/${iid}/draft_notes/bulk_publish`, {
        method: "PUT",
      });
    return P;
  }

  function github(owner, repo, num) {
    const API = "https://api.github.com";
    const base = `/repos/${owner}/${repo}`;
    let refs = null;

    const P = {
      kind: "github",
      can: { resolve: false, drafts: false, applySuggestion: false, whitespace: false },
      token: null,
      tokenHint: "no GitHub token — add one in ⚙ → Access tokens (classic PAT, repo scope)",
      setRefs: (i) => (refs = i),
    };

    const headers = (extra = {}) => {
      const h = { Accept: "application/vnd.github+json", ...extra };
      if (P.token) h.Authorization = `Bearer ${P.token}`;
      return h;
    };

    async function api(path, opts = {}, accept) {
      const resp = await fetch(`${API}${path}`, {
        ...opts,
        headers: headers(accept ? { Accept: accept } : {}),
      });
      if (!resp.ok)
        throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 200));
      if (resp.status === 204) return null;
      return accept ? resp.text() : resp.json();
    }

    async function apiPaged(path) {
      const out = [];
      let page = 1;
      for (;;) {
        const batch = await api(`${path}&per_page=100&page=${page}`);
        out.push(...batch);
        if (batch.length < 100) return out;
        page++;
      }
    }

    const noteN = (c, kind) => ({
      id: c.id,
      kind,
      author: c.user?.login || "?",
      authorId: c.user?.id,
      createdAt: c.created_at,
      body: c.body || "",
      resolved: false,
      suggestions: null,
    });

    P.init = async () => {
      P.token = await tokenFor("github.com");
    };
    P.me = () => api("/user").then((u) => ({ id: u.id, name: u.login }));
    P.info = async () => {
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
    };
    P.threads = async () => {
      const cs = await apiPaged(`${base}/pulls/${num}/comments?`);
      const roots = new Map();
      for (const c of cs) {
        const root = c.in_reply_to_id || c.id;
        if (!roots.has(root)) roots.set(root, []);
        roots.get(root).push(c);
      }
      const out = [];
      for (const [rootId, list] of roots) {
        const c0 = list[0];
        if (c0.line == null) continue; // outdated position
        out.push({
          id: rootId,
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
    };
    P.postThread = async (p, body) => {
      const payload = {
        body,
        commit_id: refs.headSha,
        path: p.path,
        line: p.side === "old" ? p.endOld : p.endNew,
        side: p.side === "old" ? "LEFT" : "RIGHT",
      };
      if (p.multiline) {
        payload.start_line = p.side === "old" ? p.start.old : p.start.new;
        payload.start_side = payload.side;
      }
      const c = await api(`${base}/pulls/${num}/comments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return [noteN(c, "line")];
    };
    P.reply = async (t, body) => {
      if (t.general)
        return noteN(
          await api(`${base}/issues/${num}/comments`, {
            method: "POST",
            body: JSON.stringify({ body }),
          }),
          "issue"
        );
      return noteN(
        await api(`${base}/pulls/${num}/comments/${t.id}/replies`, {
          method: "POST",
          body: JSON.stringify({ body }),
        }),
        "line"
      );
    };
    P.editNote = async (note, body) => {
      const path =
        note.kind === "issue"
          ? `${base}/issues/comments/${note.id}`
          : `${base}/pulls/comments/${note.id}`;
      return (await api(path, { method: "PATCH", body: JSON.stringify({ body }) })).body;
    };
    P.deleteNote = (note) =>
      api(
        note.kind === "issue"
          ? `${base}/issues/comments/${note.id}`
          : `${base}/pulls/comments/${note.id}`,
        { method: "DELETE" }
      );
    P.review = async ({ body, action }) => {
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
    };
    async function myReviews() {
      const meU = await P.me().catch(() => null);
      if (!meU) return [];
      const rs = await apiPaged(`${base}/pulls/${num}/reviews?`);
      return rs.filter((r) => r.user?.id === meU.id);
    }
    P.approvedByMe = async () => {
      const mine = await myReviews();
      const last = mine.filter((r) => ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)).pop();
      return last?.state === "APPROVED";
    };
    P.commits = () =>
      apiPaged(`${base}/pulls/${num}/commits?`).then((cs) =>
        cs.map((c) => ({
          sha: c.sha,
          short: c.sha.slice(0, 8),
          title: (c.commit?.message || "").split("\n")[0],
        }))
      );
    P.commitDiff = async (sha) => {
      const r = await chrome.runtime.sendMessage({
        type: "fetchText",
        url: `https://github.com/${owner}/${repo}/commit/${sha}.diff`,
      });
      if (!r?.ok) throw new Error(r?.text || "fetch failed");
      return r.text;
    };
    const fileCache = new Map();
    P.fetchFile = (path) => {
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
      return fileCache.get(path);
    };
    P.markdown = (text) =>
      api(
        "/markdown",
        { method: "POST", body: JSON.stringify({ text, mode: "gfm", context: `${owner}/${repo}` }) },
        "text/html"
      );
    P.permalink = (path, side, line) =>
      refs
        ? `https://github.com/${owner}/${repo}/blob/${side === "old" ? refs.baseSha : refs.headSha}/${encodeURI(path)}#L${line}`
        : null;
    P.blobUrl = (path) =>
      refs
        ? `https://github.com/${owner}/${repo}/blob/${refs.headSha}/${encodeURI(path)}`
        : null;
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