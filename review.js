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

"use strict";

// The threads store lives in content.js's bundle (where <DiffFile> reads it);
// this controller writes to it through window.ptStore.
const { setReviewThreads, setComposing } = window.ptStore;

(() => {
  const P = window.ptProvider;
  if (!P) return;

  let me = null;
  let refs = null;
  let currentCommit = "";
  let approvedByMe = false;
  let approveEls = null;
  let drafts = [];
  let unresolvedEl = null;
  let reviewSum = null;

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function status(text, isError) {
    const el = document.getElementById("pt-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pt-error", !!isError);
    if (!isError) setTimeout(() => (el.textContent = ""), 5000);
  }

  function updateReviewSummary() {
    if (reviewSum)
      reviewSum.textContent = drafts.length ? `Submit review (${drafts.length})` : "Submit review";
  }

  // real (loaded) threads incl. general discussion; drafts are pending
  // pseudo-threads. Both feed one reactive store the diff renders from, so
  // there is no imperative row insertion or refreshThreads() full rebuild.
  let realThreads = [];

  function draftToThread(d) {
    return {
      id: `draft:${d.id}`,
      _draft: d,
      general: false,
      resolvable: false,
      resolved: false,
      pending: true,
      pos: d.pos,
      notes: [
        {
          id: d.id,
          kind: "draft",
          author: me?.name || "You",
          authorId: me?.id,
          createdAt: "",
          body: d.body,
          resolved: false,
        },
      ],
    };
  }

  function publishThreads() {
    setReviewThreads([...realThreads, ...drafts.filter((d) => d.pos).map(draftToThread)]);
  }

  function replaceThread(id, fn) {
    realThreads = realThreads.flatMap((t) => (t.id === id ? fn(t) : [t]));
    publishThreads();
  }

  function updateUnresolved() {
    if (!unresolvedEl) return;
    const open = realThreads.filter((t) => t.resolvable && !t.resolved);
    unresolvedEl.dd.style.display = open.length ? "" : "none";
    unresolvedEl.sum.querySelector(".pt-dd-label").textContent = `${open.length} unresolved`;
    unresolvedEl.menu.textContent = "";
    for (const t of open) {
      const note = t.notes[0];
      const loc = t.pos
        ? `${t.pos.path.split("/").pop()}:${t.pos.newLine || t.pos.oldLine}`
        : "discussion";
      const snippet = (note?.body || "").replace(/\s+/g, " ").slice(0, 60);
      window.ptView.menuItem(
        unresolvedEl.menu,
        `<span class="pt-sha">${esc(loc)}</span><span>${esc(snippet)}</span>`,
        () => {
          unresolvedEl.dd.open = false;
          scrollToThread(t);
        }
      );
    }
  }

  function scrollToThread(t) {
    if (!t.pos) return;
    const sel = t.pos.newLine
      ? `tr[data-path="${CSS.escape(t.pos.path)}"][data-new="${t.pos.newLine}"]`
      : `tr[data-path="${CSS.escape(t.pos.path)}"][data-old="${t.pos.oldLine}"]`;
    const row = document.querySelector(sel);
    const target =
      row?.nextElementSibling?.classList.contains("pt-comments-row") ? row.nextElementSibling : row;
    target?.scrollIntoView({ block: "center" });
    target?.classList.add("pt-flash");
    setTimeout(() => target?.classList.remove("pt-flash"), 1200);
  }

  const mdCache = new Map();
  async function renderMarkdown(text) {
    if (!text.trim()) return "";
    if (mdCache.has(text)) return mdCache.get(text);
    let html;
    try {
      html = await P.markdown(text);
    } catch {
      html = `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
    }
    html = html.replace(/<p>\s*<\/p>/g, "").replace(/(<br\s*\/?>\s*)+<\/(p|li)>/g, "</$2>");
    mdCache.set(text, html);
    return html;
  }

  async function loadThreads() {
    realThreads = (await P.threads()).filter((t) => t.general || t.pos);
    publishThreads();
    updateUnresolved();
    const counts = new Map();
    for (const t of realThreads)
      if (t.pos) counts.set(t.pos.path, (counts.get(t.pos.path) || 0) + 1);
    window.ptView.markCommented?.(counts);
  }

  async function loadDrafts() {
    if (!P.can.drafts || !P.token) return;
    try {
      drafts = await P.drafts();
      updateReviewSummary();
      publishThreads();
    } catch {
      // draft notes API may be absent — review still works
    }
  }

  function refreshThreads() {
    loadThreads().catch((e) => status(`discussions unavailable: ${e.message}`, true));
    loadDrafts();
  }

  // Action bridge for the Solid thread components (src/components/Thread.tsx).
  // Each call hits the provider then updates the store surgically, so only the
  // touched thread re-renders — no page-wide refresh.
  window.ptReview = {
    get me() {
      return me;
    },
    get token() {
      return !!P.token;
    },
    can: P.can,
    renderMarkdown,
    status,
    reply: async (t, body) => {
      const note = await P.reply(t, body);
      replaceThread(t.id, (x) => [{ ...x, notes: [...x.notes, note] }]);
      status("reply posted");
    },
    draftReply: async (t, body) => {
      const d = await P.postDraft(null, body, t.id);
      drafts.push({ ...d, pos: d.pos || t.pos });
      updateReviewSummary();
      publishThreads();
      status("added to review");
    },
    resolve: async (t, value) => {
      try {
        await P.resolveThread(t, value);
        replaceThread(t.id, (x) => [
          { ...x, resolved: value, notes: x.notes.map((n) => ({ ...n, resolved: value })) },
        ]);
        updateUnresolved();
        status(value ? "thread resolved" : "thread unresolved");
      } catch (e) {
        status(`resolve failed: ${e.message}`, true);
      }
    },
    editNote: async (t, note, body) => {
      const nb = await P.editNote(note, body);
      replaceThread(t.id, (x) => [
        { ...x, notes: x.notes.map((n) => (n.id === note.id ? { ...n, body: nb } : n)) },
      ]);
      status("comment updated");
    },
    deleteNote: async (t, note) => {
      try {
        await P.deleteNote(note);
        replaceThread(t.id, (x) => {
          const notes = x.notes.filter((n) => n.id !== note.id);
          return notes.length ? [{ ...x, notes }] : [];
        });
        status("comment deleted");
      } catch (e) {
        status(`delete failed: ${e.message}`, true);
      }
    },
    discardDraft: async (t) => {
      try {
        await P.deleteDraft(t._draft);
        drafts = drafts.filter((x) => x.id !== t._draft.id);
        updateReviewSummary();
        publishThreads();
        status("draft discarded");
      } catch (e) {
        status(`discard failed: ${e.message}`, true);
      }
    },
    submitComment: async (pos, body) => {
      await P.postThread(pos.desc, body);
      setComposing(null);
      await loadThreads();
      status("comment posted");
    },
    draftComment: async (pos, body) => {
      const d = await P.postDraft(pos.desc, body);
      drafts.push(d);
      updateReviewSummary();
      setComposing(null);
      publishThreads();
      status("added to review");
    },
    applySuggestion: async (t, part, line, meta) => {
      try {
        await P.applySuggestion({
          id: meta?.id,
          path: t.pos?.path,
          startLine: line - part.minus,
          endLine: line + part.plus,
          text: part.sug,
        });
        status("suggestion applied");
      } catch (e) {
        status(`apply failed: ${e.message}`, true);
        throw e;
      }
    },
    dismissSuggestion: async (t) => {
      try {
        await P.resolveThread(t, true);
        replaceThread(t.id, (x) => [{ ...x, resolved: true }]);
        updateUnresolved();
        status("suggestion dismissed");
      } catch (e) {
        status(`dismiss failed: ${e.message}`, true);
        throw e;
      }
    },
  };

  function setApproved(v) {
    approvedByMe = v;
    const badge = document.getElementById("pt-approved");
    if (badge) badge.hidden = !v;
    if (approveEls) {
      approveEls.b.textContent = v ? "Unapprove" : "Approve";
      approveEls.small.textContent = v
        ? "Revoke your approval of these changes."
        : "Submit feedback and approve these changes.";
    }
  }

  // still used by the inline note editor and the review-summary textarea
  function surround(ta, before, after = before) {
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || "text";
    ta.setRangeText(before + sel + after, s, e);
    ta.focus();
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + sel.length;
  }

  function prefixLines(ta, prefixFor) {
    const v = ta.value;
    const start = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let end = v.indexOf("\n", ta.selectionEnd);
    if (end === -1) end = v.length;
    const block = v
      .slice(start, end)
      .split("\n")
      .map((line, i) => prefixFor(i) + line)
      .join("\n");
    ta.setRangeText(block, start, end);
    ta.focus();
    ta.selectionStart = start;
    ta.selectionEnd = start + block.length;
  }

  function mdToolbar(ta, suggestionText) {
    const bar = document.createElement("div");
    bar.className = "pt-md-bar";
    const icons = window.ptIcons || {};
    const add = (icon, title, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = icons[icon] || icon;
      b.title = title;
      b.className = cls;
      b.addEventListener("click", fn);
      bar.appendChild(b);
    };
    add("heading", "Heading", "pt-md-h", () => prefixLines(ta, () => "### "));
    add("bold", "Bold", "pt-md-b", () => surround(ta, "**"));
    add("italic", "Italic", "pt-md-i", () => surround(ta, "_"));
    add("code", "Code", "pt-md-code", () => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel.includes("\n")) surround(ta, "```\n", "\n```");
      else surround(ta, "`");
    });
    add("ul", "Bulleted list", "pt-md-ul", () => prefixLines(ta, () => "- "));
    add("ol", "Numbered list", "pt-md-ol", () => prefixLines(ta, (i) => `${i + 1}. `));
    if (suggestionText != null)
      add("diff", "Insert suggestion", "pt-md-sug", () => {
        const s = ta.selectionStart;
        const block = `\`\`\`suggestion:-0+0\n${suggestionText}\n\`\`\`\n`;
        ta.setRangeText(block, s, ta.selectionEnd);
        ta.focus();
        const lineStart = s + block.indexOf("\n") + 1;
        ta.selectionStart = lineStart;
        ta.selectionEnd = lineStart + suggestionText.length;
      });
    return bar;
  }

  // thin adapter: mount the Solid <CommentForm> into a host the callers append

  function buildCommitSelect(bar) {
    const { dd, sum, menu } = window.ptView.makeDropdown(
      `${window.ptIcons?.commit || ""}<span class="pt-dd-label">All commits</span>`
    );
    dd.id = "pt-commits";
    bar.prepend(dd);
    const items = [];

    const choose = async (sha, label, item) => {
      dd.open = false;
      if (sha === currentCommit) return;
      currentCommit = sha;
      sum.querySelector(".pt-dd-label").textContent =
        label.length > 44 ? `${label.slice(0, 43)}…` : label;
      for (const i of items) i.classList.toggle("pt-active", i === item);
      try {
        let text = window.ptView.initialRaw;
        if (sha) text = await P.commitDiff(sha);
        window.ptView.renderDiff(text);
        if (!sha) refreshThreads();
      } catch (e) {
        status(`commit diff failed: ${e.message}`, true);
      }
    };

    const addItem = (sha, html, label) => {
      const item = window.ptView.menuItem(menu, html, (it) => choose(sha, label, it));
      items.push(item);
      return item;
    };

    addItem("", "All commits", "All commits").classList.add("pt-active");
    P.commits()
      .then((commits) => {
        for (const c of commits)
          addItem(
            c.sha,
            `<span class="pt-sha">${esc(c.short)}</span><span>${esc(c.title)}</span>`,
            c.title
          );
      })
      .catch((e) => status(`commits unavailable: ${e.message}`, true));
    return dd;
  }

  function buildReviewDropdown(bar) {
    const dd = document.createElement("details");
    dd.id = "pt-review";
    const sum = document.createElement("summary");
    sum.textContent = "Submit review";
    reviewSum = sum;
    dd.appendChild(sum);

    const panel = document.createElement("div");
    panel.className = "pt-review-panel";

    const ta = document.createElement("textarea");
    ta.rows = 4;
    ta.placeholder = "Summary comment (optional)";
    panel.appendChild(mdToolbar(ta));
    panel.appendChild(ta);

    const actions = [
      ["comment", "Comment", "Submit general feedback without explicit approval."],
      ["approve", "Approve", "Submit feedback and approve these changes."],
      ["request", "Request changes", "Submit feedback that should be addressed before merging."],
    ];
    for (const [value, label, hint] of actions) {
      const lab = document.createElement("label");
      lab.className = "pt-radio";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "pt-review-action";
      input.value = value;
      if (value === "comment") input.checked = true;
      lab.appendChild(input);
      const txt = document.createElement("span");
      txt.innerHTML = `<b>${label}</b><br><small>${hint}</small>`;
      lab.appendChild(txt);
      panel.appendChild(lab);
      if (value === "approve")
        approveEls = { b: txt.querySelector("b"), small: txt.querySelector("small") };
    }

    const submit = document.createElement("button");
    submit.className = "pt-primary";
    submit.textContent = "Submit review";
    panel.appendChild(submit);
    dd.appendChild(panel);

    submit.addEventListener("click", async () => {
      submit.disabled = true;
      try {
        if (drafts.length && P.can.drafts) {
          await P.publishDrafts();
          drafts = [];
          updateReviewSummary();
          refreshThreads();
        }
        const wasApproved = approvedByMe;
        const body = ta.value.trim();
        const mode = panel.querySelector("input[name=pt-review-action]:checked").value;
        const action = mode === "approve" ? (wasApproved ? "unapprove" : "approve") : mode;
        await P.review({ body, action });
        if (mode === "approve") setApproved(!wasApproved);
        ta.value = "";
        dd.open = false;
        status(
          mode === "approve"
            ? wasApproved
              ? "approval revoked"
              : "approved"
            : mode === "request"
              ? "changes requested"
              : "comment posted"
        );
      } catch (err) {
        status(`review failed: ${err.message}`, true);
      } finally {
        submit.disabled = false;
      }
    });

    bar.appendChild(dd);
  }

  function lineNo(tr, side) {
    return +(side === "old" ? tr.dataset.old : tr.dataset.new) || 0;
  }

  function clickSide(td, tr) {
    if (tr.closest("table").classList.contains("pt-split"))
      return td.cellIndex === 0 ? "old" : "new";
    return tr.classList.contains("pt-del") ? "old" : "new";
  }

  function buildPosDesc(f) {
    const row = (tr) => ({
      old: +tr.dataset.old || null,
      new: +tr.dataset.new || null,
      codeOld: tr.dataset.codeOld,
      codeNew: tr.dataset.codeNew,
      ctx: tr.dataset.ctx === "1",
    });
    const end = row(f.endTr);
    return {
      path: f.endTr.dataset.path,
      oldPath: f.endTr.dataset.oldPath || f.endTr.dataset.path,
      side: f.side,
      ctx: end.ctx,
      endOld: end.old,
      endNew: end.new,
      multiline: f.startTr !== f.endTr,
      start: row(f.startTr),
      end,
    };
  }

  function onLineClick(e) {
    const td = e.target.closest(".pt-no");
    if (!td || td.classList.contains("pt-void")) return;
    const tr = td.closest("tr");
    if (!tr?.dataset.path) return;
    if (e.altKey) {
      const side0 = clickSide(td, tr);
      const n = lineNo(tr, side0);
      const p = side0 === "old" ? tr.dataset.oldPath || tr.dataset.path : tr.dataset.path;
      const url = n && P.permalink(p, side0, n);
      if (url) {
        navigator.clipboard.writeText(url);
        status("line link copied");
      }
      return;
    }
    if (!P.token) return;
    if (currentCommit) {
      status("line comments work only in All commits view", true);
      return;
    }
    if (!refs) return;
    const side = clickSide(td, tr);
    const line = lineNo(tr, side);
    if (!line) return;

    // <DiffFile> renders the form row reactively at this anchor; the descriptor
    // carries the row's data-* so the provider can build the API position.
    setComposing({
      path: tr.dataset.path,
      oldPath: tr.dataset.oldPath || tr.dataset.path,
      side,
      oldLine: side === "old" ? line : null,
      newLine: side === "new" ? line : null,
      desc: buildPosDesc({ side, startTr: tr, endTr: tr }),
    });
  }

  async function setup() {
    await P.init();

    const bar = window.ptView.bar;
    const st = document.createElement("span");
    st.id = "pt-status";

    const select = buildCommitSelect(bar);
    select.after(st);

    const badge = document.createElement("span");
    badge.id = "pt-approved";
    badge.textContent = "✓ Approved by you";
    badge.hidden = true;
    select.after(badge);

    unresolvedEl = window.ptView.makeDropdown(`<span class="pt-dd-label">unresolved</span>`);
    unresolvedEl.dd.id = "pt-unresolved";
    unresolvedEl.dd.style.display = "none";
    select.after(unresolvedEl.dd);

    if (P.can.whitespace) {
      const wsCb = document.createElement("input");
      wsCb.type = "checkbox";
      window.ptView.addSettingRow?.("Ignore whitespace", wsCb);
      wsCb.addEventListener("change", async () => {
        try {
          const text = wsCb.checked ? await P.whitespaceDiff() : window.ptView.initialRaw;
          window.ptView.renderDiff(text);
          refreshThreads();
        } catch (e) {
          status(`whitespace toggle failed: ${e.message}`, true);
        }
      });
    }

    if (P.token) {
      buildReviewDropdown(bar);
    } else {
      const hint = document.createElement("span");
      hint.id = "pt-hint";
      hint.textContent = P.tokenHint;
      st.after(hint);
    }

    try {
      const info = await P.info();
      refs = info;
      P.setRefs(info);
      document.title = info.title;
      if (info.ci) {
        const ci = document.createElement("a");
        ci.id = "pt-ci";
        ci.href = info.ci.url;
        ci.target = "_blank";
        ci.rel = "noopener";
        ci.dataset.state = info.ci.state;
        ci.textContent = `● ${info.ci.state}`;
        unresolvedEl.dd.after(ci);
      }
      if (info.conflicts) {
        const cf = document.createElement("span");
        cf.id = "pt-conflicts";
        cf.textContent = "⚠ has conflicts";
        unresolvedEl.dd.after(cf);
      }
    } catch (e) {
      status(`info unavailable: ${e.message}`, true);
    }

    const decorateHeaders = () => {
      if (!refs) return;
      for (const sec of document.querySelectorAll(".pt-file")) {
        if (sec.querySelector(".pt-blob-link")) continue;
        const url = P.blobUrl(sec.dataset.path);
        if (!url) continue;
        const a = document.createElement("a");
        a.className = "pt-hbtn pt-blob-link";
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = "Open at head revision";
        a.innerHTML = window.ptIcons?.external || "↗";
        sec.querySelector(".pt-stats")?.before(a);
      }
    };
    decorateHeaders();
    const origRender = window.ptView.renderDiff;
    window.ptView.renderDiff = (t) => {
      origRender(t);
      decorateHeaders();
    };

    window.ptView.fetchFile = P.fetchFile;

    try {
      me = await P.me();
      setApproved(await P.approvedByMe(me.id));
    } catch {
      // approval state is cosmetic; token may be missing
    }

    loadThreads().catch((e) => status(`discussions unavailable: ${e.message}`, true));
    loadDrafts();

    window.ptView.root.addEventListener("click", onLineClick);
  }

  // Defer to a macrotask so the browser paints the diff before any network
  // request (threads, PR info, drafts) starts — the diff must show first.
  const start = () => setTimeout(setup, 0);
  if (window.ptView) start();
  else window.addEventListener("pt-rendered", start, { once: true });
})();