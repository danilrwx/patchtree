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

  function commentForm(placeholder, onSubmit) {
    const wrap = document.createElement("div");
    wrap.className = "pt-comment-form";
    const ta = document.createElement("textarea");
    ta.placeholder = placeholder;
    ta.rows = 3;
    const send = document.createElement("button");
    send.textContent = "Comment";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    wrap.append(ta, send, cancel);
    cancel.addEventListener("click", () => wrap.remove());
    send.addEventListener("click", async () => {
      if (!ta.value.trim()) return;
      send.disabled = true;
      try {
        await onSubmit(ta.value);
        wrap.remove();
      } catch (e) {
        status(`comment failed: ${e.message}`, true);
        send.disabled = false;
      }
    });
    ta.focus();
    return wrap;
  }

  function onLineClick(e) {
    const td = e.target.closest(".pt-no");
    if (!td || !token) return;
    const tr = td.closest("tr");
    if (!tr?.dataset.path || !diffRefs) return;
    if (tr.nextSibling?.classList?.contains("pt-inline-form")) return;

    const formRow = document.createElement("tr");
    formRow.className = "pt-inline-form";
    const cell = formRow.insertCell();
    cell.colSpan = 4;
    cell.appendChild(
      commentForm("Comment on this line…", async (body) => {
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
      })
    );
    insertAfter(tr, formRow);
  }

  function addButton(bar, label, handler) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", handler);
    bar.insertBefore(b, bar.firstChild);
    return b;
  }

  async function setup() {
    const { gitlabs = {} } = await chrome.storage.sync.get("gitlabs");
    token = gitlabs[location.host]?.token || null;

    const bar = window.ptView.bar;
    const st = document.createElement("span");
    st.id = "pt-status";
    bar.insertBefore(st, bar.firstChild);

    if (token) {
      addButton(bar, "Request changes", async (e) => {
        e.target.disabled = true;
        try {
          await graphql(
            `mutation($p: ID!, $iid: String!) {
               mergeRequestRequestChanges(input: {projectPath: $p, iid: $iid}) { errors }
             }`,
            { p: projectPath, iid }
          );
          status("changes requested");
        } catch (err) {
          status(`request changes failed: ${err.message}`, true);
        } finally {
          e.target.disabled = false;
        }
      });

      addButton(bar, "Comment", (e) => {
        if (bar.querySelector(".pt-comment-form")) return;
        const form = commentForm("Comment on the merge request…", async (body) => {
          await api(`/projects/${project}/merge_requests/${iid}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
          });
          status("comment posted");
        });
        bar.parentNode.insertBefore(form, bar.nextSibling);
      });

      const approveBtn = addButton(bar, "Approve", async () => {
        approveBtn.disabled = true;
        try {
          if (approveBtn.dataset.approved) {
            await api(`/projects/${project}/merge_requests/${iid}/unapprove`, { method: "POST" });
            delete approveBtn.dataset.approved;
            approveBtn.textContent = "Approve";
            status("approval revoked");
          } else {
            await api(`/projects/${project}/merge_requests/${iid}/approve`, { method: "POST" });
            approveBtn.dataset.approved = "1";
            approveBtn.textContent = "Unapprove";
            status("approved");
          }
        } catch (err) {
          status(`failed: ${err.message}`, true);
        } finally {
          approveBtn.disabled = false;
        }
      });
    } else {
      const hint = document.createElement("span");
      hint.id = "pt-hint";
      hint.textContent = "no token for this GitLab — set one in extension options to comment/approve";
      bar.insertBefore(hint, bar.firstChild);
    }

    try {
      const mr = await api(`/projects/${project}/merge_requests/${iid}`);
      diffRefs = mr.diff_refs;
      document.title = `!${iid} ${mr.title}`;
    } catch (e) {
      status(`MR info unavailable: ${e.message}`, true);
    }

    loadDiscussions().catch((e) => status(`discussions unavailable: ${e.message}`, true));

    if (token) window.ptView.root.addEventListener("click", onLineClick);
  }

  if (window.ptView) setup();
  else window.addEventListener("pt-rendered", setup, { once: true });
})();
