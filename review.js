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

import { render } from "solid-js/web";
import { CommentForm } from "./src/components/CommentForm";

(() => {
  const P = window.ptProvider;
  if (!P) return;

  let me = null;
  let refs = null;
  let currentCommit = "";
  let approvedByMe = false;
  let approveEls = null;
  let drafts = [];
  let lastThreads = [];
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

  function updateUnresolved() {
    if (!unresolvedEl) return;
    const open = lastThreads.filter((t) => t.resolvable && !t.resolved);
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
          const target = t._target?.isConnected ? t._target : null;
          target?.scrollIntoView({ block: "center" });
          target?.classList.add("pt-flash");
          setTimeout(() => target?.classList.remove("pt-flash"), 1200);
        }
      );
    }
  }

  function rowsFor(path, oldLine, newLine) {
    const sel = newLine
      ? `tr[data-path="${CSS.escape(path)}"][data-new="${newLine}"]`
      : `tr[data-path="${CSS.escape(path)}"][data-old="${oldLine}"]`;
    return document.querySelectorAll(sel);
  }

  // In the split view a thread occupies only its side's half, GitHub-style;
  // the unified view keeps the full-width row.
  function threadRow(tr, side, cls) {
    const row = document.createElement("tr");
    row.className = cls;
    let td;
    if (tr.closest("table").classList.contains("pt-split")) {
      if (side === "old") {
        td = row.insertCell();
        td.colSpan = 2;
        const pad = row.insertCell();
        pad.colSpan = 2;
        pad.className = "pt-void";
      } else {
        const pad = row.insertCell();
        pad.colSpan = 2;
        pad.className = "pt-void";
        td = row.insertCell();
        td.colSpan = 2;
      }
    } else {
      td = row.insertCell();
      td.colSpan = 4;
    }
    return { row, td };
  }

  function insertAfter(tr, el) {
    tr.parentNode.insertBefore(el, tr.nextSibling);
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
    // GitLab's markdown API emits whitespace-only <p> for blank source lines,
    // which CSS :empty can't target — drop them and trailing breaks
    html = html
      .replace(/<p>\s*<\/p>/g, "")
      .replace(/(<br\s*\/?>\s*)+<\/(p|li)>/g, "</$2>");
    mdCache.set(text, html);
    return html;
  }

  function splitSuggestions(body) {
    const parts = [];
    const re = /```suggestion(?::-(\d+)\+(\d+))?\n([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(body))) {
      if (m.index > last) parts.push({ md: body.slice(last, m.index) });
      parts.push({ sug: m[3].replace(/\n$/, ""), minus: +(m[1] || 0), plus: +(m[2] || 0) });
      last = m.index + m[0].length;
    }
    if (last < body.length) parts.push({ md: body.slice(last) });
    return parts;
  }

  function suggestionWidget(part, anchorTr, sugMeta, thread) {
    const box = document.createElement("div");
    box.className = "pt-sug";
    const head = document.createElement("div");
    head.className = "pt-sug-head";
    head.textContent = "Suggested change";
    if (thread?.resolvable && !thread.resolved && P.can.resolve && P.token) {
      const dismiss = document.createElement("button");
      dismiss.className = "pt-apply";
      dismiss.textContent = "Dismiss";
      dismiss.title = "Resolve the thread without applying";
      dismiss.addEventListener("click", async () => {
        dismiss.disabled = true;
        try {
          await P.resolveThread(thread, true);
          thread.resolved = true;
          updateUnresolved();
          dismiss.textContent = "Dismissed";
          status("suggestion dismissed");
        } catch (e) {
          status(`dismiss failed: ${e.message}`, true);
          dismiss.disabled = false;
        }
      });
      head.appendChild(dismiss);
    }
    // Apply needs a target line: GitLab carries a suggestion id, GitHub
    // reconstructs the line range from the anchored new-side row.
    const line = +(anchorTr?.dataset.new || 0);
    if (P.can.applySuggestion && P.token && (sugMeta || line)) {
      const btn = document.createElement("button");
      btn.className = "pt-apply";
      btn.textContent = sugMeta?.applied ? "Applied" : "Apply suggestion";
      btn.disabled = !!sugMeta?.applied || sugMeta?.appliable === false;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await P.applySuggestion({
            id: sugMeta?.id,
            path: anchorTr?.dataset.path,
            startLine: line - part.minus,
            endLine: line + part.plus,
            text: part.sug,
          });
          btn.textContent = "Applied";
          status("suggestion applied");
        } catch (e) {
          status(`apply failed: ${e.message}`, true);
          btn.disabled = false;
        }
      });
      head.appendChild(btn);
    }
    box.appendChild(head);
    const table = document.createElement("table");
    table.className = "pt-sug-table";
    const addRow = (cls, mark, text) => {
      const tr = table.insertRow();
      tr.className = cls;
      const tm = tr.insertCell();
      tm.className = "pt-mark";
      tm.textContent = mark;
      const tc = tr.insertCell();
      tc.className = "pt-code";
      tc.textContent = text;
    };
    const L = +(anchorTr?.dataset.new || 0);
    if (L) {
      const tbl = anchorTr.closest("table");
      for (let n = L - part.minus; n <= L + part.plus; n++) {
        const row = tbl.querySelector(
          `tr[data-path="${CSS.escape(anchorTr.dataset.path)}"][data-new="${n}"]`
        );
        addRow("pt-del", "−", row ? [...row.querySelectorAll(".pt-code")].pop().textContent : "");
      }
    }
    for (const line of part.sug.split("\n")) addRow("pt-add", "+", line);
    box.appendChild(table);
    return box;
  }

  async function renderNote(note, anchorTr, thread) {
    const div = document.createElement("div");
    div.className = "pt-note" + (note.resolved ? " pt-resolved" : "");
    const head = document.createElement("div");
    head.className = "pt-note-head";
    head.innerHTML =
      `<span class="pt-note-author">${esc(note.author)}</span>` +
      `<span class="pt-note-date">${esc(new Date(note.createdAt).toLocaleString())}</span>`;
    div.appendChild(head);
    const bodyEl = document.createElement("div");
    bodyEl.className = "pt-note-body";
    div.appendChild(bodyEl);

    const paint = async () => {
      bodyEl.textContent = "";
      let sugIdx = 0;
      for (const p of splitSuggestions(note.body || "")) {
        if (p.sug !== undefined)
          bodyEl.appendChild(suggestionWidget(p, anchorTr, note.suggestions?.[sugIdx++], thread));
        else {
          const md = document.createElement("div");
          md.className = "pt-md";
          md.innerHTML = await renderMarkdown(p.md);
          bodyEl.appendChild(md);
        }
      }
    };
    await paint();

    if (P.token && me && note.authorId === me.id) {
      const actions = document.createElement("span");
      actions.className = "pt-note-actions";
      const editBtn = document.createElement("button");
      editBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/></svg>';
      editBtn.title = "Edit";
      const delBtn = document.createElement("button");
      delBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>';
      delBtn.title = "Delete";
      actions.append(editBtn, delBtn);
      head.appendChild(actions);

      editBtn.addEventListener("click", () => {
        if (div.querySelector("textarea")) return;
        const ta = document.createElement("textarea");
        ta.rows = 5;
        ta.value = note.body;
        const save = document.createElement("button");
        save.textContent = "Save";
        save.className = "pt-primary";
        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        const act = document.createElement("div");
        act.className = "pt-form-actions";
        act.append(cancel, save);
        const wrap = document.createElement("div");
        wrap.className = "pt-comment-form";
        wrap.append(mdToolbar(ta), ta, act);
        bodyEl.style.display = "none";
        div.appendChild(wrap);
        cancel.addEventListener("click", () => {
          wrap.remove();
          bodyEl.style.display = "";
        });
        save.addEventListener("click", async () => {
          save.disabled = true;
          try {
            note.body = await P.editNote(note, ta.value);
            wrap.remove();
            bodyEl.style.display = "";
            await paint();
            refreshThreads();
            status("comment updated");
          } catch (e) {
            status(`edit failed: ${e.message}`, true);
            save.disabled = false;
          }
        });
      });

      delBtn.addEventListener("click", async () => {
        if (delBtn.dataset.arm !== "1") {
          delBtn.dataset.arm = "1";
          delBtn.classList.add("pt-armed");
          delBtn.title = "Click again to delete";
          setTimeout(() => {
            delBtn.dataset.arm = "";
            delBtn.classList.remove("pt-armed");
            delBtn.title = "Delete";
          }, 3000);
          return;
        }
        try {
          await P.deleteNote(note);
          refreshThreads();
          status("comment deleted");
        } catch (e) {
          status(`delete failed: ${e.message}`, true);
        }
      });
    }
    return div;
  }

  function renderDraft(draft, anchorTr) {
    const div = document.createElement("div");
    div.className = "pt-note pt-pending";
    const head = document.createElement("div");
    head.className = "pt-note-head";
    head.innerHTML =
      `<span class="pt-note-author">${esc(me?.name || "You")}</span>` +
      `<span class="pt-badge-pending">Pending</span>`;
    const delBtn = document.createElement("button");
    delBtn.className = "pt-draft-del";
    delBtn.textContent = "discard";
    delBtn.addEventListener("click", async () => {
      try {
        await P.deleteDraft(draft);
        drafts = drafts.filter((x) => x.id !== draft.id);
        updateReviewSummary();
        refreshThreads();
        status("draft discarded");
      } catch (e) {
        status(`discard failed: ${e.message}`, true);
      }
    });
    head.appendChild(delBtn);
    div.appendChild(head);
    const bodyEl = document.createElement("div");
    bodyEl.className = "pt-note-body";
    div.appendChild(bodyEl);
    (async () => {
      for (const p of splitSuggestions(draft.body || "")) {
        if (p.sug !== undefined) bodyEl.appendChild(suggestionWidget(p, anchorTr));
        else {
          const md = document.createElement("div");
          md.className = "pt-md";
          md.innerHTML = await renderMarkdown(p.md);
          bodyEl.appendChild(md);
        }
      }
    })();
    return div;
  }

  function addDraftRow(draft, tr, side) {
    const { row, td } = threadRow(tr, side, "pt-comments-row");
    insertAfter(tr, row);
    td.appendChild(renderDraft(draft, tr));
  }

  async function loadDrafts() {
    if (!P.can.drafts || !P.token) return;
    try {
      const list = await P.drafts();
      drafts = list;
      updateReviewSummary();
      for (const d of list) {
        if (!d.pos) continue;
        for (const tr of rowsFor(d.pos.path, d.pos.oldLine, d.pos.newLine))
          addDraftRow(d, tr, d.pos.side);
      }
    } catch {
      // draft notes API may be absent — review still works
    }
  }

  function replyButton(t, anchorTr, td) {
    const btn = document.createElement("button");
    btn.className = "pt-reply-btn";
    btn.innerHTML = `${window.ptIcons?.reply || ""}<span>Reply…</span>`;
    btn.addEventListener("click", () => {
      if (td.querySelector(".pt-comment-form")) return;
      btn.style.display = "none";
      const anchor = () => btn.closest(".pt-thread-actions") || btn;
      const form = commentForm(
        "Reply…",
        async (body) => {
          const note = await P.reply(t, body);
          anchor().before(await renderNote(note, anchorTr, t));
          refreshThreads();
          status("reply posted");
        },
        () => (btn.style.display = ""),
        anchorTr?.dataset.new
          ? [...anchorTr.querySelectorAll(".pt-code")].pop().textContent
          : null,
        P.can.drafts
          ? async (body) => {
              const draft = await P.postDraft(null, body, t.id);
              drafts.push(draft);
              updateReviewSummary();
              anchor().before(renderDraft(draft, anchorTr));
              status("added to review");
            }
          : null
      );
      anchor().before(form);
    });
    return btn;
  }

  function threadActions(t, container, anchorTr) {
    const wrap = document.createElement("div");
    wrap.className = "pt-thread-actions";
    wrap.appendChild(replyButton(t, anchorTr, container));
    if (P.can.resolve && t.resolvable) {
      const btn = document.createElement("button");
      btn.className = "pt-reply-btn";
      const setLbl = () =>
        (btn.innerHTML = `${window.ptIcons?.check || ""}<span>${t.resolved ? "Unresolve" : "Resolve"}</span>`);
      setLbl();
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const v = !t.resolved;
          await P.resolveThread(t, v);
          t.resolved = v;
          setLbl();
          for (const el of container.querySelectorAll(".pt-note"))
            el.classList.toggle("pt-resolved", v);
          updateUnresolved();
          status(v ? "thread resolved" : "thread unresolved");
        } catch (e) {
          status(`resolve failed: ${e.message}`, true);
        } finally {
          btn.disabled = false;
        }
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function renderGeneralThreads(general) {
    const box = document.createElement("details");
    box.id = "pt-mr-threads";
    box.open = true;
    const sum = document.createElement("summary");
    sum.textContent = `Discussion (${general.length})`;
    box.appendChild(sum);
    for (const t of general) {
      const el = document.createElement("div");
      el.className = "pt-thread";
      box.appendChild(el);
      t._target = el;
      Promise.all(t.notes.map((n) => renderNote(n, null))).then((els) => {
        el.append(...els);
        if (P.token) el.appendChild(threadActions(t, el, null));
      });
    }
    document.getElementById("pt-main").prepend(box);
  }

  async function loadThreads() {
    document.getElementById("pt-mr-threads")?.remove();
    const threads = await P.threads();
    lastThreads = threads;
    let shown = 0;
    const general = [];
    for (const t of threads) {
      if (t.general) {
        general.push(t);
        continue;
      }
      const trs = rowsFor(t.pos.path, t.pos.oldLine, t.pos.newLine);
      if (!trs.length) continue;
      for (const tr of trs) {
        const { row, td } = threadRow(tr, t.pos.side, "pt-comments-row");
        insertAfter(tr, row);
        if (!t._target || !t._target.isConnected) t._target = row;
        Promise.all(t.notes.map((n) => renderNote(n, tr, t))).then((els) => {
          td.append(...els);
          if (P.token) td.appendChild(threadActions(t, td, tr));
        });
      }
      shown++;
    }
    if (general.length) renderGeneralThreads(general);
    updateUnresolved();
    const counts = new Map();
    for (const t of threads)
      if (t.pos) counts.set(t.pos.path, (counts.get(t.pos.path) || 0) + 1);
    window.ptView.markCommented?.(counts);
    if (shown) status(`${shown} thread(s) loaded`);
  }

  function refreshThreads() {
    document.getElementById("pt-mr-threads")?.remove();
    for (const r of document.querySelectorAll(".pt-comments-row")) r.remove();
    loadThreads().catch((e) => status(`discussions unavailable: ${e.message}`, true));
    loadDrafts();
  }

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
        const block = "```suggestion:-0+0\n" + suggestionText + "\n```\n";
        ta.setRangeText(block, s, ta.selectionEnd);
        ta.focus();
        const lineStart = s + block.indexOf("\n") + 1;
        ta.selectionStart = lineStart;
        ta.selectionEnd = lineStart + suggestionText.length;
      });
    return bar;
  }

  // thin adapter: mount the Solid <CommentForm> into a host the callers append
  function commentForm(placeholder, onSubmit, onClose, suggestionText, onDraft) {
    const wrap = document.createElement("div");
    let dispose;
    dispose = render(
      () =>
        CommentForm({
          placeholder,
          onSubmit,
          onDraft,
          suggestionText,
          renderMarkdown,
          onError: (m) => status(m, true),
          onClose: () => {
            dispose();
            wrap.remove();
            onClose?.();
          },
        }),
      wrap
    );
    return wrap;
  }

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
        label.length > 44 ? label.slice(0, 43) + "…" : label;
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

  let activeForm = null;

  function lineNo(tr, side) {
    return +(side === "old" ? tr.dataset.old : tr.dataset.new) || 0;
  }

  function clickSide(td, tr) {
    if (tr.closest("table").classList.contains("pt-split"))
      return td.cellIndex === 0 ? "old" : "new";
    return tr.classList.contains("pt-del") ? "old" : "new";
  }

  function closeActiveForm() {
    if (!activeForm) return;
    activeForm.formRow.remove();
    for (const r of activeForm.marked) r.classList.remove("pt-range");
    activeForm = null;
  }

  function markRange(f) {
    for (const r of f.marked) r.classList.remove("pt-range");
    f.marked = [];
    for (let r = f.startTr; r; r = r.nextElementSibling) {
      if (lineNo(r, f.side)) {
        r.classList.add("pt-range");
        f.marked.push(r);
      }
      if (r === f.endTr) break;
    }
    f.label.textContent =
      f.startTr === f.endTr
        ? `Comment on line ${lineNo(f.endTr, f.side)}`
        : `Comment on lines ${lineNo(f.startTr, f.side)}–${lineNo(f.endTr, f.side)}`;
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
    if (!lineNo(tr, side)) return;

    if (
      e.shiftKey &&
      activeForm &&
      activeForm.path === tr.dataset.path &&
      activeForm.side === side &&
      activeForm.table === tr.closest("table")
    ) {
      const f = activeForm;
      if (lineNo(tr, side) < lineNo(f.startTr, side)) f.startTr = tr;
      else f.endTr = tr;
      insertAfter(f.endTr, f.formRow);
      markRange(f);
      return;
    }

    closeActiveForm();

    const f = {
      path: tr.dataset.path,
      side,
      table: tr.closest("table"),
      startTr: tr,
      endTr: tr,
      marked: [],
      label: document.createElement("div"),
    };
    f.label.className = "pt-comment-lines";

    const { row: formRow, td: cell } = threadRow(tr, side, "pt-inline-form");
    f.formRow = formRow;
    cell.appendChild(f.label);
    cell.appendChild(
      commentForm(
        "Leave a comment (shift-click a line number to extend the range)…",
        async (body) => {
          await P.postThread(buildPosDesc(f), body);
          refreshThreads();
          status("comment posted");
        },
        closeActiveForm,
        side === "new" && tr.dataset.new
          ? [...tr.querySelectorAll(".pt-code")].pop().textContent
          : null,
        P.can.drafts
          ? async (body) => {
              const draft = await P.postDraft(buildPosDesc(f), body);
              drafts.push(draft);
              updateReviewSummary();
              addDraftRow(draft, f.endTr, side);
              status("added to review");
            }
          : null
      )
    );
    insertAfter(tr, formRow);
    activeForm = f;
    markRange(f);
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

  if (window.ptView) setup();
  else window.addEventListener("pt-rendered", setup, { once: true });
})();