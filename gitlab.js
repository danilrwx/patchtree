"use strict";

(() => {
  const m = /^\/(.+)\/-\/merge_requests\/(\d+)\.(?:diff|patch)$/.exec(location.pathname);
  if (!m) return;
  const projectPath = m[1];
  const iid = m[2];
  const project = encodeURIComponent(projectPath);

  let token = null;
  let diffRefs = null;
  let me = null;
  let drafts = [];
  let lastDiscussions = [];
  let unresolvedEl = null;
  let reviewSum = null;

  function updateReviewSummary() {
    if (reviewSum)
      reviewSum.textContent = drafts.length ? `Submit review (${drafts.length})` : "Submit review";
  }

  function updateUnresolved() {
    if (!unresolvedEl) return;
    const n = lastDiscussions.filter((d) => {
      const first = (d.notes || []).find((x) => x.resolvable);
      return first && !first.resolved;
    }).length;
    unresolvedEl.textContent = n ? `${n} unresolved` : "";
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function headers(extra = {}) {
    const h = { ...extra };
    if (token) h["PRIVATE-TOKEN"] = token;
    return h;
  }

  async function api(path, opts = {}) {
    const resp = await fetch(`${location.origin}/api/v4${path}`, {
      ...opts,
      headers: headers(opts.body ? { "Content-Type": "application/json" } : {}),
    });
    if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`.slice(0, 200));
    return resp.status === 204 ? null : resp.json();
  }

  async function apiPaged(path) {
    const out = [];
    let page = 1;
    while (page) {
      const resp = await fetch(`${location.origin}/api/v4${path}&per_page=100&page=${page}`, {
        headers: headers(),
      });
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
    const errors = data.errors?.map((e) => e.message) || data.data?.mergeRequestRequestChanges?.errors;
    if (errors?.length) throw new Error(errors.join("; ").slice(0, 200));
    return data.data;
  }

  function status(text, isError) {
    const el = document.getElementById("pt-status");
    el.textContent = text;
    el.classList.toggle("pt-error", !!isError);
    if (!isError) setTimeout(() => (el.textContent = ""), 5000);
  }

  const mdCache = new Map();
  async function renderMarkdown(text) {
    if (!text.trim()) return "";
    if (mdCache.has(text)) return mdCache.get(text);
    let html;
    try {
      const d = await api("/markdown", {
        method: "POST",
        body: JSON.stringify({ text, gfm: true, project: projectPath }),
      });
      html = d.html;
    } catch {
      html = `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
    }
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

  function suggestionWidget(part, anchorTr, sugMeta) {
    const box = document.createElement("div");
    box.className = "pt-sug";
    const head = document.createElement("div");
    head.className = "pt-sug-head";
    head.textContent = "Suggested change";
    if (sugMeta && token) {
      const btn = document.createElement("button");
      btn.className = "pt-apply";
      btn.textContent = sugMeta.applied ? "Applied" : "Apply suggestion";
      btn.disabled = sugMeta.applied || sugMeta.appliable === false;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api(`/projects/${project}/suggestions/${sugMeta.id}/apply`, { method: "PUT" });
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

  async function renderNote(note, anchorTr) {
    const div = document.createElement("div");
    div.className = "pt-note" + (note.resolved ? " pt-resolved" : "");
    const head = document.createElement("div");
    head.className = "pt-note-head";
    head.innerHTML =
      `<span class="pt-note-author">${esc(note.author?.name || "?")}</span>` +
      `<span class="pt-note-date">${esc(new Date(note.created_at).toLocaleString())}</span>`;
    div.appendChild(head);
    const bodyEl = document.createElement("div");
    bodyEl.className = "pt-note-body";
    div.appendChild(bodyEl);

    const paint = async () => {
      bodyEl.textContent = "";
      let sugIdx = 0;
      for (const p of splitSuggestions(note.body || "")) {
        if (p.sug !== undefined)
          bodyEl.appendChild(suggestionWidget(p, anchorTr, note.suggestions?.[sugIdx++]));
        else {
          const md = document.createElement("div");
          md.className = "pt-md";
          md.innerHTML = await renderMarkdown(p.md);
          bodyEl.appendChild(md);
        }
      }
    };
    await paint();

    if (token && me && note.author?.id === me.id) {
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
            const updated = await api(
              `/projects/${project}/merge_requests/${iid}/notes/${note.id}`,
              { method: "PUT", body: JSON.stringify({ body: ta.value }) }
            );
            note.body = updated.body;
            wrap.remove();
            bodyEl.style.display = "";
            await paint();
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
          await api(`/projects/${project}/merge_requests/${iid}/notes/${note.id}`, {
            method: "DELETE",
          });
          div.remove();
          status("comment deleted");
        } catch (e) {
          status(`delete failed: ${e.message}`, true);
        }
      });
    }
    return div;
  }

  function rowsFor(path, oldLine, newLine) {
    const sel = newLine
      ? `tr[data-path="${CSS.escape(path)}"][data-new="${newLine}"]`
      : `tr[data-path="${CSS.escape(path)}"][data-old="${oldLine}"]`;
    return document.querySelectorAll(sel);
  }

  async function sha1hex(s) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

  function threadActions(d, container, anchorTr) {
    const wrap = document.createElement("div");
    wrap.className = "pt-thread-actions";
    wrap.appendChild(replyButton(d.id, anchorTr, container));
    const first = (d.notes || []).find((n) => n.resolvable);
    if (first) {
      const btn = document.createElement("button");
      btn.className = "pt-reply-btn";
      const setLbl = () =>
        (btn.innerHTML = `${window.ptIcons?.check || ""}<span>${first.resolved ? "Unresolve" : "Resolve"}</span>`);
      setLbl();
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const v = !first.resolved;
          await api(
            `/projects/${project}/merge_requests/${iid}/discussions/${d.id}?resolved=${v}`,
            { method: "PUT" }
          );
          for (const n of d.notes) if (n.resolvable) n.resolved = v;
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
    sum.textContent = `MR discussion (${general.length})`;
    box.appendChild(sum);
    for (const { d, notes } of general) {
      const t = document.createElement("div");
      t.className = "pt-thread";
      box.appendChild(t);
      Promise.all(notes.map((n) => renderNote(n, null))).then((els) => {
        t.append(...els);
        if (token) t.appendChild(threadActions(d, t, null));
      });
    }
    document.getElementById("pt-main").prepend(box);
  }

  async function loadDiscussions() {
    document.getElementById("pt-mr-threads")?.remove();
    const discussions = await apiPaged(
      `/projects/${project}/merge_requests/${iid}/discussions?order_by=created_at`
    );
    lastDiscussions = discussions;
    let shown = 0;
    const general = [];
    for (const d of discussions) {
      const notes = (d.notes || []).filter((n) => !n.system);
      if (!notes.length) continue;
      const pos = notes[0].position;
      if (!pos || pos.position_type !== "text") {
        general.push({ d, notes });
        continue;
      }
      const path = pos.new_path || pos.old_path;
      const side = pos.new_line ? "new" : "old";
      const trs = rowsFor(path, pos.old_line, pos.new_line);
      if (!trs.length) continue;
      for (const tr of trs) {
        const { row, td } = threadRow(tr, side, "pt-comments-row");
        insertAfter(tr, row);
        Promise.all(notes.map((n) => renderNote(n, tr))).then((els) => {
          td.append(...els);
          if (token) td.appendChild(threadActions(d, td, tr));
        });
      }
      shown++;
    }
    if (general.length) renderGeneralThreads(general);
    updateUnresolved();
    if (shown) status(`${shown} thread(s) loaded`);
  }

  function refreshThreads() {
    document.getElementById("pt-mr-threads")?.remove();
    for (const r of document.querySelectorAll(".pt-comments-row")) r.remove();
    loadDiscussions().catch((e) => status(`discussions unavailable: ${e.message}`, true));
    loadDrafts();
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
        await api(`/projects/${project}/merge_requests/${iid}/draft_notes/${draft.id}`, {
          method: "DELETE",
        });
        drafts = drafts.filter((x) => x.id !== draft.id);
        updateReviewSummary();
        div.remove();
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
      for (const p of splitSuggestions(draft.note || "")) {
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
    if (!token) return;
    try {
      const list = await apiPaged(`/projects/${project}/merge_requests/${iid}/draft_notes?`);
      drafts = list;
      updateReviewSummary();
      for (const d of list) {
        const pos = d.position;
        if (pos?.position_type !== "text") continue;
        const side = pos.new_line ? "new" : "old";
        for (const tr of rowsFor(pos.new_path || pos.old_path, pos.old_line, pos.new_line))
          addDraftRow(d, tr, side);
      }
    } catch {
      // draft notes API may be absent on older GitLab — review still works
    }
  }

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

  function replyButton(discussionId, anchorTr, td) {
    const btn = document.createElement("button");
    btn.className = "pt-reply-btn";
    btn.innerHTML = `${window.ptIcons?.reply || ""}<span>Reply…</span>`;
    btn.addEventListener("click", () => {
      if (td.querySelector(".pt-comment-form")) return;
      btn.style.display = "none";
      const form = commentForm(
        "Reply…",
        async (body) => {
          const note = await api(
            `/projects/${project}/merge_requests/${iid}/discussions/${discussionId}/notes`,
            { method: "POST", body: JSON.stringify({ body }) }
          );
          btn.before(await renderNote(note, anchorTr));
          status("reply posted");
        },
        () => (btn.style.display = ""),
        anchorTr?.dataset.new
          ? [...anchorTr.querySelectorAll(".pt-code")].pop().textContent
          : null,
        async (body) => {
          const draft = await api(`/projects/${project}/merge_requests/${iid}/draft_notes`, {
            method: "POST",
            body: JSON.stringify({ note: body, in_reply_to_discussion_id: discussionId }),
          });
          drafts.push(draft);
          updateReviewSummary();
          btn.before(renderDraft(draft, anchorTr));
          status("added to review");
        }
      );
      btn.before(form);
    });
    return btn;
  }

  function commentForm(placeholder, onSubmit, onClose, suggestionText, onDraft) {
    const wrap = document.createElement("div");
    wrap.className = "pt-comment-form";
    const ta = document.createElement("textarea");
    ta.placeholder = placeholder;
    ta.rows = 3;
    wrap.appendChild(mdToolbar(ta, suggestionText));
    const send = document.createElement("button");
    send.textContent = "Comment";
    send.className = "pt-primary";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    const actions = document.createElement("div");
    actions.className = "pt-form-actions";
    actions.append(cancel);
    const close = () => {
      wrap.remove();
      onClose?.();
    };
    const wire = (btn, fn) =>
      btn.addEventListener("click", async () => {
        if (!ta.value.trim()) return;
        btn.disabled = true;
        try {
          await fn(ta.value);
          close();
        } catch (e) {
          status(`comment failed: ${e.message}`, true);
          btn.disabled = false;
        }
      });
    if (onDraft) {
      const draftBtn = document.createElement("button");
      draftBtn.textContent = "Add to review";
      wire(draftBtn, onDraft);
      actions.append(draftBtn);
    }
    actions.append(send);
    wrap.append(ta, actions);
    cancel.addEventListener("click", close);
    wire(send, onSubmit);
    setTimeout(() => ta.focus());
    return wrap;
  }

  let currentCommit = "";
  let approvedByMe = false;
  let approveEls = null;

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

  function lineType(tr, side) {
    if (tr.dataset.ctx === "1") return null;
    return side === "new" ? "new" : "old";
  }

  async function buildPosition(f) {
    const end = f.endTr;
    const side = f.side;
    const position = {
      base_sha: diffRefs.base_sha,
      start_sha: diffRefs.start_sha,
      head_sha: diffRefs.head_sha,
      position_type: "text",
      new_path: end.dataset.path,
      old_path: end.dataset.oldPath || end.dataset.path,
    };
    // a paired replacement row carries both numbers pointing at DIFFERENT
    // lines — only context rows may send both sides
    if (end.dataset.ctx === "1") {
      if (end.dataset.new) position.new_line = +end.dataset.new;
      if (end.dataset.old) position.old_line = +end.dataset.old;
    } else if (side === "old") {
      position.old_line = +end.dataset.old;
    } else {
      position.new_line = +end.dataset.new;
    }
    if (f.startTr !== end) {
      const sha = await sha1hex(end.dataset.path);
      const lc = (r) => `${sha}_${r.dataset.codeOld}_${r.dataset.codeNew}`;
      position.line_range = {
        start: { line_code: lc(f.startTr), type: lineType(f.startTr, side) },
        end: { line_code: lc(end), type: lineType(end, side) },
      };
    }
    return position;
  }

  function onLineClick(e) {
    const td = e.target.closest(".pt-no");
    if (!td || td.classList.contains("pt-void")) return;
    const tr = td.closest("tr");
    if (!tr?.dataset.path) return;
    if (e.altKey) {
      const side0 = clickSide(td, tr);
      const n = lineNo(tr, side0);
      const sha = side0 === "old" ? diffRefs?.base_sha : diffRefs?.head_sha;
      const p = side0 === "old" ? tr.dataset.oldPath || tr.dataset.path : tr.dataset.path;
      if (sha && n) {
        navigator.clipboard.writeText(
          `${location.origin}/${projectPath}/-/blob/${sha}/${encodeURI(p)}#L${n}`
        );
        status("line link copied");
      }
      return;
    }
    if (!token) return;
    if (currentCommit) {
      status("line comments work only in All commits view", true);
      return;
    }
    if (!diffRefs) return;
    const side = clickSide(td, tr);
    if (!lineNo(tr, side)) return;

    if (e.shiftKey && activeForm && activeForm.path === tr.dataset.path && activeForm.side === side && activeForm.table === tr.closest("table")) {
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
          const position = await buildPosition(f);
          const d = await api(`/projects/${project}/merge_requests/${iid}/discussions`, {
            method: "POST",
            body: JSON.stringify({ body, position }),
          });
          const { row, td: td2 } = threadRow(f.endTr, side, "pt-comments-row");
          insertAfter(formRow, row);
          Promise.all((d.notes || []).map((n) => renderNote(n, f.endTr))).then((els) =>
            td2.append(...els)
          );
          status("comment posted");
        },
        closeActiveForm,
        side === "new" && tr.dataset.new
          ? [...tr.querySelectorAll(".pt-code")].pop().textContent
          : null,
        async (body) => {
          const position = await buildPosition(f);
          const draft = await api(`/projects/${project}/merge_requests/${iid}/draft_notes`, {
            method: "POST",
            body: JSON.stringify({ note: body, position }),
          });
          drafts.push(draft);
          updateReviewSummary();
          addDraftRow(draft, f.endTr, side);
          status("added to review");
        }
      )
    );
    insertAfter(tr, formRow);
    activeForm = f;
    markRange(f);
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
        if (sha) {
          const r = await fetch(`${location.origin}/${projectPath}/-/commit/${sha}.diff`);
          if (!r.ok) throw new Error(`${r.status}`);
          text = await r.text();
        }
        window.ptView.renderDiff(text);
        if (!sha)
          loadDiscussions().catch((e) => status(`discussions unavailable: ${e.message}`, true));
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
    apiPaged(`/projects/${project}/merge_requests/${iid}/commits?`)
      .then((commits) => {
        for (const c of commits)
          addItem(
            c.id,
            `<span class="pt-sha">${esc(c.short_id)}</span><span>${esc(c.title)}</span>`,
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
        if (drafts.length) {
          await api(`/projects/${project}/merge_requests/${iid}/draft_notes/bulk_publish`, {
            method: "PUT",
          });
          drafts = [];
          updateReviewSummary();
          refreshThreads();
        }
        const body = ta.value.trim();
        if (body)
          await api(`/projects/${project}/merge_requests/${iid}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
          });
        const mode = panel.querySelector("input[name=pt-review-action]:checked").value;
        if (mode === "approve") {
          const ep = approvedByMe ? "unapprove" : "approve";
          await api(`/projects/${project}/merge_requests/${iid}/${ep}`, { method: "POST" });
          setApproved(!approvedByMe);
        } else if (mode === "request")
          await graphql(
            `mutation($p: ID!, $iid: String!) {
               mergeRequestRequestChanges(input: {projectPath: $p, iid: $iid}) { errors }
             }`,
            { p: projectPath, iid }
          );
        ta.value = "";
        dd.open = false;
        status(
          mode === "approve"
            ? approvedByMe
              ? "approved"
              : "approval revoked"
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

  async function setup() {
    const { gitlabs = {} } = await chrome.storage.sync.get("gitlabs");
    token = gitlabs[location.host]?.token || null;

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

    unresolvedEl = document.createElement("span");
    unresolvedEl.id = "pt-unresolved";
    select.after(unresolvedEl);

    const wsCb = document.createElement("input");
    wsCb.type = "checkbox";
    window.ptView.addSettingRow?.("Ignore whitespace", wsCb);
    wsCb.addEventListener("change", async () => {
      try {
        let text = window.ptView.initialRaw;
        if (wsCb.checked) {
          const r = await fetch(`${location.href}?w=1`);
          if (!r.ok) throw new Error(`${r.status}`);
          text = await r.text();
        }
        window.ptView.renderDiff(text);
        refreshThreads();
      } catch (e) {
        status(`whitespace toggle failed: ${e.message}`, true);
      }
    });

    if (token) {
      buildReviewDropdown(bar);
    } else {
      const hint = document.createElement("span");
      hint.id = "pt-hint";
      hint.textContent = "no token for this GitLab — set one in ⚙ options to review";
      st.after(hint);
    }

    try {
      const mr = await api(`/projects/${project}/merge_requests/${iid}`);
      diffRefs = mr.diff_refs;
      document.title = `!${iid} ${mr.title}`;
      if (mr.head_pipeline) {
        const ci = document.createElement("a");
        ci.id = "pt-ci";
        ci.href = mr.head_pipeline.web_url;
        ci.target = "_blank";
        ci.rel = "noopener";
        ci.dataset.state = mr.head_pipeline.status;
        ci.textContent = `● ${mr.head_pipeline.status}`;
        unresolvedEl.after(ci);
      }
      if (mr.has_conflicts) {
        const cf = document.createElement("span");
        cf.id = "pt-conflicts";
        cf.textContent = "⚠ has conflicts";
        unresolvedEl.after(cf);
      }
    } catch (e) {
      status(`MR info unavailable: ${e.message}`, true);
    }

    const decorateHeaders = () => {
      if (!diffRefs) return;
      for (const sec of document.querySelectorAll(".pt-file")) {
        if (sec.querySelector(".pt-blob-link")) continue;
        const a = document.createElement("a");
        a.className = "pt-hbtn pt-blob-link";
        a.href = `${location.origin}/${projectPath}/-/blob/${diffRefs.head_sha}/${encodeURI(sec.dataset.path)}`;
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

    const fileCache = new Map();
    window.ptView.fetchFile = (path) => {
      if (!fileCache.has(path))
        fileCache.set(
          path,
          (async () => {
            const ref = diffRefs?.head_sha || "HEAD";
            const r = await fetch(
              `${location.origin}/api/v4/projects/${project}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`,
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

    try {
      me = await api("/user");
      const appr = await api(`/projects/${project}/merge_requests/${iid}/approvals`);
      setApproved(!!appr.approved_by?.some((a) => a.user?.id === me.id));
    } catch {
      // approvals may be unavailable (no auth, CE without approvals) — badge stays hidden
    }

    loadDiscussions().catch((e) => status(`discussions unavailable: ${e.message}`, true));
    loadDrafts();

    window.ptView.root.addEventListener("click", onLineClick);
  }

  if (window.ptView) setup();
  else window.addEventListener("pt-rendered", setup, { once: true });
})();
