"use strict";

(() => {
  const m = /^\/(.+)\/-\/merge_requests\/(\d+)\.(?:diff|patch)$/.exec(location.pathname);
  if (!m) return;
  const projectPath = m[1];
  const iid = m[2];
  const project = encodeURIComponent(projectPath);

  let token = null;
  let diffRefs = null;

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
    return resp.json();
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

  function noteHTML(note) {
    const when = new Date(note.created_at).toLocaleString();
    return (
      `<div class="pt-note${note.resolved ? " pt-resolved" : ""}">` +
      `<span class="pt-note-author">${esc(note.author?.name || "?")}</span>` +
      `<span class="pt-note-date">${esc(when)}</span>` +
      `<div class="pt-note-body">${esc(note.body || "")}</div></div>`
    );
  }

  function rowsFor(path, oldLine, newLine) {
    const sel = newLine
      ? `tr[data-path="${CSS.escape(path)}"][data-new="${newLine}"]`
      : `tr[data-path="${CSS.escape(path)}"][data-old="${oldLine}"]`;
    return document.querySelectorAll(sel);
  }

  function insertAfter(tr, el) {
    tr.parentNode.insertBefore(el, tr.nextSibling);
  }

  async function loadDiscussions() {
    const discussions = await apiPaged(
      `/projects/${project}/merge_requests/${iid}/discussions?order_by=created_at`
    );
    let shown = 0;
    for (const d of discussions) {
      const notes = (d.notes || []).filter((n) => !n.system);
      const pos = notes[0]?.position;
      if (!pos || pos.position_type !== "text") continue;
      const path = pos.new_path || pos.old_path;
      const trs = rowsFor(path, pos.old_line, pos.new_line);
      if (!trs.length) continue;
      for (const tr of trs) {
        const row = document.createElement("tr");
        row.className = "pt-comments-row";
        const td = row.insertCell();
        td.colSpan = 4;
        td.innerHTML = notes.map(noteHTML).join("");
        insertAfter(tr, row);
      }
      shown++;
    }
    if (shown) status(`${shown} thread(s) loaded`);
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
    const add = (label, title, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.className = cls;
      b.addEventListener("click", fn);
      bar.appendChild(b);
    };
    add("H", "Heading", "pt-md-h", () => prefixLines(ta, () => "### "));
    add("B", "Bold", "pt-md-b", () => surround(ta, "**"));
    add("I", "Italic", "pt-md-i", () => surround(ta, "_"));
    add("<>", "Code", "pt-md-code", () => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel.includes("\n")) surround(ta, "```\n", "\n```");
      else surround(ta, "`");
    });
    add("• —", "Bulleted list", "pt-md-ul", () => prefixLines(ta, () => "- "));
    add("1. —", "Numbered list", "pt-md-ol", () => prefixLines(ta, (i) => `${i + 1}. `));
    if (suggestionText != null)
      add("±", "Insert suggestion", "pt-md-sug", () => {
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

  function commentForm(placeholder, onSubmit, onClose, suggestionText) {
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
    actions.append(cancel, send);
    wrap.append(ta, actions);
    const close = () => {
      wrap.remove();
      onClose?.();
    };
    cancel.addEventListener("click", close);
    send.addEventListener("click", async () => {
      if (!ta.value.trim()) return;
      send.disabled = true;
      try {
        await onSubmit(ta.value);
        close();
      } catch (e) {
        status(`comment failed: ${e.message}`, true);
        send.disabled = false;
      }
    });
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

  function onLineClick(e) {
    const td = e.target.closest(".pt-no");
    if (!td || !token) return;
    if (currentCommit) {
      status("line comments work only in All commits view", true);
      return;
    }
    const tr = td.closest("tr");
    if (!tr?.dataset.path || !diffRefs) return;
    if (tr.nextSibling?.classList?.contains("pt-inline-form")) return;

    const formRow = document.createElement("tr");
    formRow.className = "pt-inline-form";
    const cell = formRow.insertCell();
    cell.colSpan = 4;
    cell.appendChild(
      commentForm(
        "Comment on this line…",
        async (body) => {
          const position = {
            base_sha: diffRefs.base_sha,
            start_sha: diffRefs.start_sha,
            head_sha: diffRefs.head_sha,
            position_type: "text",
            new_path: tr.dataset.path,
            old_path: tr.dataset.oldPath || tr.dataset.path,
          };
          if (tr.dataset.new) position.new_line = +tr.dataset.new;
          if (tr.dataset.old) position.old_line = +tr.dataset.old;
          const d = await api(`/projects/${project}/merge_requests/${iid}/discussions`, {
            method: "POST",
            body: JSON.stringify({ body, position }),
          });
          const row = document.createElement("tr");
          row.className = "pt-comments-row";
          const td2 = row.insertCell();
          td2.colSpan = 4;
          td2.innerHTML = (d.notes || []).map(noteHTML).join("");
          insertAfter(formRow, row);
          status("comment posted");
        },
        () => formRow.remove(),
        tr.dataset.new ? [...tr.querySelectorAll(".pt-code")].pop().textContent : null
      )
    );
    insertAfter(tr, formRow);
  }

  function buildCommitSelect(bar) {
    const { dd, sum, menu } = window.ptView.makeDropdown("All commits");
    dd.id = "pt-commits";
    bar.prepend(dd);
    const items = [];

    const choose = async (sha, label, item) => {
      dd.open = false;
      if (sha === currentCommit) return;
      currentCommit = sha;
      sum.textContent = label.length > 44 ? label.slice(0, 43) + "…" : label;
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
    } catch (e) {
      status(`MR info unavailable: ${e.message}`, true);
    }

    try {
      const [me, appr] = await Promise.all([
        api("/user"),
        api(`/projects/${project}/merge_requests/${iid}/approvals`),
      ]);
      setApproved(!!appr.approved_by?.some((a) => a.user?.id === me.id));
    } catch {
      // approvals may be unavailable (no auth, CE without approvals) — badge stays hidden
    }

    loadDiscussions().catch((e) => status(`discussions unavailable: ${e.message}`, true));

    if (token) window.ptView.root.addEventListener("click", onLineClick);
  }

  if (window.ptView) setup();
  else window.addEventListener("pt-rendered", setup, { once: true });
})();
