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

import { setReviewThreads, setComposing, composing, setReviewApi, treeFiles } from "./store";
import { icons } from "./icons";
import { esc } from "./diff";
import { flashCenter, makeDropdown, menuFilter, menuItem, surround, prefixLines } from "./ui";
import type { Provider } from "./types";

// The imperative surface content.ts builds and hands to the review controller.
export interface PtView {
  bar: HTMLElement;
  // slot above the first file for the request's title and description
  desc: HTMLElement;
  root: HTMLElement;
  renderDiff: (text: string) => void;
  initialRaw: string;
  addSettingRow: (label: string, control: HTMLElement) => void;
  markCommented: (counts: Map<string, number>) => void;
}

// Review controller: loads threads into the store, wires the action bridge
// (setReviewApi) the thread components read, and handles line-comment clicks.
// content.ts calls this — deferred — once the diff has painted.
export function initReview(P: Provider, view: PtView) {
  // ponytail: provider threads/drafts are normalized to the store shape; typed
  // any here to avoid fighting the provider-Thread vs ReviewThread mismatch
  let me: { id: any; name: string } | null = null;
  let refs: any = null;
  let ciState = "";
  let currentCommit = "";
  let approvedByMe = false;
  let approveEls: {
    b: HTMLElement | null;
    small: HTMLElement | null;
    // the prose only; the CI note is a sibling so rewriting one keeps the other
    hint: HTMLElement | null;
  } | null = null;
  let drafts: any[] = [];
  let unresolvedEl: any = null;
  let reviewSum: HTMLElement | null = null;



  const STATE_LABEL: Record<string, string> = {
    open: "Open",
    draft: "Draft",
    merged: "Merged",
    closed: "Closed",
  };

  // "5 days ago" — the narrow style renders Russian as "-5 дн.", where the
  // minus reads like an error; short stays compact and unambiguous. The exact
  // timestamp lives in the title attribute.
  function relativeTime(iso: string) {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
    const secs = (Date.parse(iso) - Date.now()) / 1000;
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
      ["year", 31536000],
      ["month", 2592000],
      ["week", 604800],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
    ];
    for (const [unit, size] of steps)
      if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
    return rtf.format(Math.round(secs), "second");
  }


  // The request's title and description, shown where a git-format patch shows
  // its commit message — same place, same purpose: what this change is about,
  // before the diff itself. The body goes through the platform's markdown API,
  // so checklists, links and code fences render as the author wrote them.
  async function renderDescription(info: any) {
    const host = view.desc;
    if (!host) return;
    host.textContent = "";
    if (!info.title) return;

    const title = document.createElement(info.webUrl ? "a" : "h1") as HTMLAnchorElement;
    title.className = "pt-desc-title";
    if (info.webUrl) {
      title.href = info.webUrl;
      title.title = `Open the ${P.kind === "gitlab" ? "merge" : "pull"} request`;
    }
    title.textContent = info.title;
    host.appendChild(title);

    const body = (info.description || "").trim();
    if (!body) return;

    const md = document.createElement("div");
    md.className = "pt-md pt-desc-body";
    md.innerHTML = await renderMarkdown(body);
    host.appendChild(md);

    // a long description would push the diff off-screen; clamp it and offer the
    // rest behind one click, measuring after layout so short bodies stay open
    requestAnimationFrame(() => {
      if (md.scrollHeight <= 340) return;
      md.classList.add("pt-desc-clamped");
      const more = document.createElement("button");
      more.type = "button";
      more.className = "pt-desc-more";
      more.textContent = "Show more";
      more.addEventListener("click", () => {
        const clamped = md.classList.toggle("pt-desc-clamped");
        more.textContent = clamped ? "Show more" : "Show less";
      });
      host.appendChild(more);
    });
  }


  // Approving a red pipeline is the mistake worth guarding against, so the note
  // sits under the Approve description, inside that same text column — a block
  // in the label itself would land in the empty space to the right.
  function markReviewCiWarning() {
    const small = approveEls?.small;
    if (!small || small.querySelector(".pt-ci-warn")) return;
    const warn = document.createElement("span");
    warn.className = "pt-ci-warn";
    warn.textContent = ciState === "failed" ? "⚠ pipeline failing" : "⚠ pipeline not green yet";
    small.appendChild(warn);
  }

  // Job states differ per platform; these are the buckets the UI colours by.
  const CI_BAD = new Set(["failed", "failure", "canceled", "cancelled", "timed_out", "error"]);
  const CI_RUNNING = new Set(["running", "pending", "queued", "in_progress", "created", "waiting_for_resource", "preparing"]);
  const ciClass = (state: string) =>
    CI_BAD.has(state) ? "failed" : CI_RUNNING.has(state) ? "running" : state === "success" ? "success" : "other";

  // The pipeline badge opens into its jobs, so a red pipeline can be inspected
  // (and understood) without leaving the diff — the point being not to approve
  // something that is broken.
  function buildCiDropdown(ci: any) {
    const { dd, sum, menu } = makeDropdown(
      `<span class="pt-dd-label">● ${esc(ci.state)}</span>`
    );
    dd.id = "pt-ci";
    dd.dataset.state = ciClass(ci.state);
    sum.title = `Pipeline ${ci.state} — open the jobs`;
    unresolvedEl.dd.after(dd);

    let loaded = false;
    dd.addEventListener("toggle", async () => {
      if (!dd.open || loaded) return;
      loaded = true;
      menu.textContent = "Loading jobs…";
      try {
        const jobs = await P.ciJobs(ci);
        menu.textContent = "";
        if (!jobs.length) {
          menu.textContent = "no jobs reported";
        } else {
          for (const j of jobs) {
            const row = menuItem(
              menu,
              `<span class="pt-job-dot" data-state="${ciClass(j.state)}">●</span>` +
                `<span class="pt-job-name">${esc(j.name)}</span>` +
                (j.stage ? `<span class="pt-sha">${esc(j.stage)}</span>` : "") +
                `<span class="pt-job-state">${esc(j.state)}</span>`,
              () => {
                dd.open = false;
                if (j.url) window.open(j.url, "_blank", "noopener");
              }
            );
            row.classList.add("pt-job");
          }
        }
        const open = menuItem(menu, "Open the full pipeline ↗", () => {
          dd.open = false;
          window.open(ci.url, "_blank", "noopener");
        });
        open.classList.add("pt-job-all");
      } catch (e: any) {
        menu.textContent = `jobs unavailable: ${e.message}`;
        loaded = false;
      }
    });
  }

  function status(text: string, isError?: boolean) {
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
  let realThreads: any[] = [];

  function draftToThread(d: any) {
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

  function replaceThread(id: unknown, fn: (t: any) => any[]) {
    realThreads = realThreads.flatMap((t) => (t.id === id ? fn(t) : [t]));
    publishThreads();
  }

  // Shared by the thread cards and the unresolved list in the bar, so resolving
  // from either place updates the store the same way.
  async function resolveThread(t: any, value: boolean) {
    try {
      await P.resolveThread(t, value);
      replaceThread(t.id, (x) => [
        { ...x, resolved: value, notes: x.notes.map((n: any) => ({ ...n, resolved: value })) },
      ]);
      updateUnresolved();
      status(value ? "thread resolved" : "thread unresolved");
    } catch (e: any) {
      status(`resolve failed: ${e.message}`, true);
    }
  }

  function updateUnresolved() {
    if (!unresolvedEl) return;
    const open = realThreads
      .filter((t) => t.resolvable && !t.resolved)
      .sort((a, b) => {
        // file order follows the rendered diff body, so walking the list
        // walks the review top to bottom; general discussion leads
        const order = treeFiles().map((f) => f.path);
        const rank = (t: any) => (t.pos ? order.indexOf(t.pos.path) + 1 : 0);
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return (a.pos?.newLine || a.pos?.oldLine || 0) - (b.pos?.newLine || b.pos?.oldLine || 0);
      });
    unresolvedEl.dd.style.display = open.length ? "" : "none";
    unresolvedEl.sum.querySelector(".pt-dd-label").textContent = `${open.length}`;
    for (const old of unresolvedEl.menu.querySelectorAll(".pt-dd-item")) old.remove();

    for (const t of open) {
      const note = t.notes[0];
      const item = document.createElement("div");
      item.className = "pt-dd-item pt-thread-row";

      const loc = document.createElement("span");
      loc.className = "pt-sha";
      loc.textContent = t.pos
        ? `${t.pos.path.split("/").pop()}:${t.pos.newLine || t.pos.oldLine}`
        : "discussion";
      if (t.pos) loc.title = t.pos.path;

      const body = document.createElement("span");
      body.className = "pt-dd-title";
      const text = (note?.body || "").replace(/\s+/g, " ").trim();
      body.textContent = text;
      body.title = text;
      item.append(loc, body);

      const meta = document.createElement("span");
      meta.className = "pt-dd-meta";
      const replies = t.notes.length - 1;
      meta.textContent = [
        note?.author,
        note?.createdAt && relativeTime(note.createdAt),
        replies > 0 && `${replies} ${replies === 1 ? "reply" : "replies"}`,
      ]
        .filter(Boolean)
        .join(" · ");
      item.appendChild(meta);

      if (P.can.resolve) {
        const acts = document.createElement("span");
        acts.className = "pt-dd-acts";
        const done = document.createElement("button");
        done.type = "button";
        done.className = "pt-hbtn";
        done.title = "Resolve this thread";
        done.innerHTML = icons.check || "";
        done.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          resolveThread(t, true);
        });
        acts.appendChild(done);
        item.appendChild(acts);
      }

      item.addEventListener("click", () => {
        unresolvedEl.dd.open = false;
        scrollToThread(t);
      });
      unresolvedEl.menu.appendChild(item);
    }
    unresolvedEl.filter?.refresh();
  }

  function scrollToThread(t: any) {
    // general discussion has no line to anchor to — it lives in its own block
    // above the first file
    if (!t.pos) {
      const el = document.getElementById("pt-mr-threads");
      if (el) flashCenter(el);
      return;
    }
    const sel = t.pos.newLine
      ? `tr[data-path="${CSS.escape(t.pos.path)}"][data-new="${t.pos.newLine}"]`
      : `tr[data-path="${CSS.escape(t.pos.path)}"][data-old="${t.pos.oldLine}"]`;
    // both the unified and split tables render the row; only one is visible, so
    // pick the laid-out one (scrollIntoView on a display:none row is a no-op)
    const rowOf = () =>
      [...document.querySelectorAll<HTMLElement>(sel)].find((r) => r.offsetParent) || null;
    const target = () => {
      const row = rowOf();
      const next = row?.nextElementSibling;
      return next?.classList.contains("pt-comments-row") ? (next as HTMLElement) : row;
    };
    const found = target();
    if (found) return flashCenter(found);
    // the file is off-screen under content-visibility, so its rows aren't laid
    // out yet — bring the section in, then centre the row once it renders
    const section = document.querySelector<HTMLElement>(
      `section.pt-file[data-path="${CSS.escape(t.pos.path)}"]`
    );
    if (!section) return;
    section.scrollIntoView({ block: "center" });
    let tries = 0;
    const wait = () => {
      const el = target();
      if (el) flashCenter(el);
      else if (tries++ < 30) requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  }

  const mdCache = new Map<string, string>();
  async function renderMarkdown(text: string) {
    if (!text.trim()) return "";
    if (mdCache.has(text)) return mdCache.get(text)!;
    let html: string;
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
    realThreads = (await P.threads()).filter((t: any) => t.general || t.pos);
    publishThreads();
    updateUnresolved();
    const counts = new Map<string, number>();
    for (const t of realThreads)
      if (t.pos) counts.set(t.pos.path, (counts.get(t.pos.path) || 0) + 1);
    view.markCommented?.(counts);
  }

  async function loadDrafts() {
    if (!P.can.drafts || !P.token) return;
    try {
      drafts = await P.drafts!();
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
  setReviewApi({
    get me() {
      return me;
    },
    get token() {
      return !!P.token;
    },
    can: P.can,
    suggestionSyntax: P.kind,
    renderMarkdown,
    status,
    reply: async (t: any, body: string) => {
      const note = await P.reply(t, body);
      replaceThread(t.id, (x) => [{ ...x, notes: [...x.notes, note] }]);
      status("reply posted");
    },
    draftReply: async (t: any, body: string) => {
      const d = await P.postDraft!(null as any, body, t.id);
      drafts.push({ ...d, pos: (d as any).pos || t.pos });
      updateReviewSummary();
      publishThreads();
      status("added to review");
    },
    resolve: resolveThread,
    editNote: async (t: any, note: any, body: string) => {
      const nb = await P.editNote(note, body);
      replaceThread(t.id, (x) => [
        { ...x, notes: x.notes.map((n: any) => (n.id === note.id ? { ...n, body: nb } : n)) },
      ]);
      status("comment updated");
    },
    deleteNote: async (t: any, note: any) => {
      try {
        await P.deleteNote(note);
        replaceThread(t.id, (x) => {
          const notes = x.notes.filter((n: any) => n.id !== note.id);
          return notes.length ? [{ ...x, notes }] : [];
        });
        status("comment deleted");
      } catch (e: any) {
        status(`delete failed: ${e.message}`, true);
      }
    },
    discardDraft: async (t: any) => {
      try {
        await P.deleteDraft!(t._draft);
        drafts = drafts.filter((x) => x.id !== t._draft.id);
        updateReviewSummary();
        publishThreads();
        status("draft discarded");
      } catch (e: any) {
        status(`discard failed: ${e.message}`, true);
      }
    },
    submitComment: async (pos: any, body: string) => {
      await P.postThread(pos.desc, body);
      setComposing(null);
      await loadThreads();
      status("comment posted");
    },
    draftComment: async (pos: any, body: string) => {
      const d = await P.postDraft!(pos.desc, body);
      drafts.push(d);
      updateReviewSummary();
      setComposing(null);
      publishThreads();
      status("added to review");
    },
    applySuggestion: async (t: any, part: any, line: number, meta: any) => {
      try {
        // GitHub carries the replaced range in the comment (startLine..line);
        // GitLab encodes it in the fence (line-minus .. line+plus)
        const start =
          t.pos?.startLine != null && t.pos.startLine < line ? t.pos.startLine : line - part.minus;
        await P.applySuggestion({
          id: meta?.id,
          path: t.pos?.path,
          startLine: start,
          endLine: line + part.plus,
          text: part.sug,
        });
        status("suggestion applied");
      } catch (e: any) {
        status(`apply failed: ${e.message}`, true);
        throw e;
      }
    },
    dismissSuggestion: async (t: any) => {
      try {
        await P.resolveThread(t, true);
        replaceThread(t.id, (x) => [{ ...x, resolved: true }]);
        updateUnresolved();
        status("suggestion dismissed");
      } catch (e: any) {
        status(`dismiss failed: ${e.message}`, true);
        throw e;
      }
    },
  });

  function setApproved(v: boolean) {
    approvedByMe = v;
    const badge = document.getElementById("pt-approved");
    if (badge) (badge as HTMLElement).hidden = !v;
    if (approveEls) {
      approveEls.b!.textContent = v ? "Unapprove" : "Approve";
      approveEls.hint!.textContent = v
        ? "Revoke your approval of these changes."
        : "Submit feedback and approve these changes.";
    }
  }

  // Markdown toolbar for the review-summary textarea (bold/italic/list/…).
  function mdToolbar(ta: HTMLTextAreaElement) {
    const bar = document.createElement("div");
    bar.className = "pt-md-bar";
    const add = (icon: string, title: string, cls: string, fn: () => void) => {
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
    return bar;
  }

  function buildCommitSelect(bar: HTMLElement) {
    // icon-only while inactive; picking a commit turns the summary into a
    // chip with the short sha and a reset ×
    const { dd, sum, menu } = makeDropdown(
      `${icons.commit || ""}<span class="pt-dd-label"></span>`
    );
    dd.id = "pt-commits";
    sum.title = "Filter by commit";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "pt-chip-clear";
    reset.title = "Show all commits";
    reset.textContent = "×";
    reset.hidden = true;
    sum.appendChild(reset);
    bar.prepend(dd);
    const items: any[] = [];

    const choose = async (sha: string, label: string, item: any) => {
      dd.open = false;
      if (sha === currentCommit) return;
      currentCommit = sha;
      sum.querySelector(".pt-dd-label")!.textContent = sha ? label : "";
      sum.classList.toggle("pt-chip-active", !!sha);
      reset.hidden = !sha;
      for (const i of items) i.classList.toggle("pt-active", i === item);
      try {
        let text = view.initialRaw;
        if (sha) text = await P.commitDiff(sha);
        view.renderDiff(text);
        if (!sha) refreshThreads();
      } catch (e: any) {
        status(`commit diff failed: ${e.message}`, true);
      }
    };

    const all = menuItem(menu, "All commits", (it: any) => choose("", "", it));
    all.classList.add("pt-active", "pt-commit-all");
    all.dataset.filter = "keep";
    const filter = menuFilter(menu, "Filter by sha, message, author…");
    items.push(all);
    reset.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      choose("", "", all);
    });

    const iconBtn = (icon: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pt-hbtn";
      b.title = title;
      b.innerHTML = icons[icon] || "";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
      return b;
    };

    const addCommit = (c: any) => {
      const item = document.createElement("div");
      item.className = "pt-dd-item pt-commit";
      const sha = document.createElement("span");
      sha.className = "pt-sha";
      sha.textContent = c.short;
      const title = document.createElement("span");
      title.className = "pt-dd-title";
      title.textContent = c.title;
      title.title = c.title;
      item.append(sha, title);
      if (c.author || c.date) {
        const meta = document.createElement("span");
        meta.className = "pt-dd-meta";
        meta.textContent = [c.author, c.date && relativeTime(c.date)].filter(Boolean).join(" · ");
        if (c.date) meta.title = new Date(c.date).toLocaleString();
        item.appendChild(meta);
      }
      const acts = document.createElement("span");
      acts.className = "pt-dd-acts";
      const copy = iconBtn("copy", "Copy the full sha", () => {
        navigator.clipboard.writeText(c.sha);
        status(`${c.short} copied`);
      });
      acts.appendChild(copy);
      if (c.webUrl) {
        const open = document.createElement("a");
        open.className = "pt-hbtn";
        open.href = c.webUrl;
        open.target = "_blank";
        open.rel = "noreferrer";
        open.title = "Open the commit on the host";
        open.innerHTML = icons.external || "";
        open.addEventListener("click", (e) => e.stopPropagation());
        acts.appendChild(open);
      }
      item.appendChild(acts);
      item.addEventListener("click", () => choose(c.sha, c.short, item));
      menu.appendChild(item);
      items.push(item);
      return item;
    };

    P.commits()
      .then((commits: any[]) => {
        for (const c of commits) addCommit(c);
        all.firstChild!.textContent = `All commits (${commits.length})`;
        filter.refresh();
      })
      .catch((e: any) => status(`commits unavailable: ${e.message}`, true));
    return dd;
  }

  function buildReviewDropdown(bar: HTMLElement) {
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
      txt.innerHTML = `<b>${label}</b><br><small><span class="pt-radio-hint">${hint}</span></small>`;
      lab.appendChild(txt);
      panel.appendChild(lab);
      if (value === "approve")
        approveEls = {
          b: txt.querySelector("b"),
          small: txt.querySelector("small"),
          hint: txt.querySelector(".pt-radio-hint"),
        };
    }

    const submit = document.createElement("button");
    submit.className = "pt-primary";
    submit.textContent = "Submit review";
    panel.appendChild(submit);
    dd.appendChild(panel);

    if (ciState && ciState !== "success") markReviewCiWarning();

    submit.addEventListener("click", async () => {
      submit.disabled = true;
      try {
        if (drafts.length && P.can.drafts) {
          await P.publishDrafts!();
          drafts = [];
          updateReviewSummary();
          refreshThreads();
        }
        const wasApproved = approvedByMe;
        const body = ta.value.trim();
        const mode = (panel.querySelector("input[name=pt-review-action]:checked") as HTMLInputElement).value;
        const action = mode === "approve" ? (wasApproved ? "unapprove" : "approve") : mode;
        await P.review({ body, action: action as any });
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
      } catch (err: any) {
        status(`review failed: ${err.message}`, true);
      } finally {
        submit.disabled = false;
      }
    });

    bar.appendChild(dd);
  }

  function lineNo(tr: HTMLElement, side: string) {
    return +((side === "old" ? tr.dataset.old : tr.dataset.new) as any) || 0;
  }

  function clickSide(td: HTMLTableCellElement, tr: HTMLElement) {
    if (tr.closest("table")!.classList.contains("pt-split"))
      return td.cellIndex === 0 ? "old" : "new";
    return tr.classList.contains("pt-del") ? "old" : "new";
  }

  function buildPosDesc(f: any) {
    const row = (tr: HTMLElement) => ({
      old: +(tr.dataset.old as any) || null,
      new: +(tr.dataset.new as any) || null,
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

  // GitHub-style range selection: press on a line number and drag over others
  // to select a range (shift-click still works via onLineClick). The range is
  // committed live to `composing` as you drag; the trailing click is swallowed.
  let drag: { path: string; side: string; startLine: number; startTr: HTMLElement } | null = null;
  let didDrag = false;
  let suppressClick = false;
  let lastStart = 0;
  let lastEnd = 0;

  const rowFor = (path: string, side: string, n: number) =>
    document.querySelector<HTMLElement>(
      `tr[data-path="${CSS.escape(path)}"][data-${side}="${n}"]`
    );

  function onLineMouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.altKey || e.shiftKey) return;
    const td = (e.target as HTMLElement).closest(".pt-no") as HTMLTableCellElement | null;
    if (!td || td.classList.contains("pt-void")) return;
    const tr = td.closest("tr") as HTMLElement | null;
    if (!tr?.dataset.path || !P.token || currentCommit || !refs) return;
    const side = clickSide(td, tr);
    const line = lineNo(tr, side);
    if (!line) return;
    drag = { path: tr.dataset.path, side, startLine: line, startTr: tr };
    didDrag = false;
    lastStart = lastEnd = 0;
  }

  function onDocMouseMove(e: MouseEvent) {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const tr = el?.closest<HTMLElement>(`tr[data-path="${CSS.escape(drag.path)}"]`);
    const line = tr && lineNo(tr, drag.side);
    if (!line) return;
    if (!didDrag) {
      if (line === drag.startLine) return;
      didDrag = true;
      document.body.style.userSelect = "none";
    }
    const start = Math.min(drag.startLine, line);
    const end = Math.max(drag.startLine, line);
    if (start === lastStart && end === lastEnd) return;
    lastStart = start;
    lastEnd = end;
    const startTr = rowFor(drag.path, drag.side, start) || drag.startTr;
    const endTr = rowFor(drag.path, drag.side, end) || tr;
    setComposing({
      path: drag.path,
      oldPath: endTr.dataset.oldPath || endTr.dataset.path!,
      side: drag.side,
      startLine: start,
      endLine: end,
      desc: buildPosDesc({ side: drag.side, startTr, endTr }),
    });
  }

  function onDocMouseUp() {
    if (drag && didDrag) suppressClick = true;
    drag = null;
    document.body.style.userSelect = "";
  }

  function onLineClick(e: MouseEvent) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const td = (e.target as HTMLElement).closest(".pt-no") as HTMLTableCellElement | null;
    if (!td || td.classList.contains("pt-void")) return;
    const tr = td.closest("tr") as HTMLElement | null;
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

    // shift-click extends the open range on the same file+side; otherwise start
    // a fresh single-line selection
    const cur = composing();
    let start = line;
    let end = line;
    if (e.shiftKey && cur && cur.path === tr.dataset.path && cur.side === side) {
      start = Math.min(cur.startLine, line);
      end = Math.max(cur.endLine, line);
    }
    const rowAt = (n: number) => rowFor(tr.dataset.path!, side, n);
    const endTr = rowAt(end) || tr;

    // <DiffFile> renders the form after endLine and marks the range; the
    // descriptor carries the rows' data-* so the provider can build the position.
    setComposing({
      path: tr.dataset.path!,
      oldPath: endTr.dataset.oldPath || endTr.dataset.path!,
      side,
      startLine: start,
      endLine: end,
      desc: buildPosDesc({ side, startTr: rowAt(start) || tr, endTr }),
    });
  }

  async function setup() {
    await P.init();

    const bar = view.bar;
    const st = document.createElement("span");
    st.id = "pt-status";

    const select = buildCommitSelect(bar);
    select.after(st);

    const badge = document.createElement("span");
    badge.id = "pt-approved";
    badge.textContent = "✓ Approved by you";
    badge.hidden = true;
    select.after(badge);

    unresolvedEl = makeDropdown(`${icons.comment}<span class="pt-dd-label"></span>`);
    unresolvedEl.dd.id = "pt-unresolved";
    unresolvedEl.sum.title = "Jump to an unresolved thread";
    unresolvedEl.dd.style.display = "none";
    unresolvedEl.filter = menuFilter(unresolvedEl.menu, "Filter by file, author, text…");
    select.after(unresolvedEl.dd);

    if (P.can.whitespace) {
      const wsCb = document.createElement("input");
      wsCb.type = "checkbox";
      view.addSettingRow?.("Ignore whitespace", wsCb);
      wsCb.addEventListener("change", async () => {
        try {
          const text = wsCb.checked ? await P.whitespaceDiff!() : view.initialRaw;
          view.renderDiff(text);
          refreshThreads();
        } catch (e: any) {
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
      P.setRefs(info as any);
      document.title = info.title;
      if (info.ci) {
        ciState = ciClass(info.ci.state);
        buildCiDropdown(info.ci);
        if (ciState !== "success") markReviewCiWarning();
      }
      if (info.conflicts) {
        const cf = document.createElement("span");
        cf.id = "pt-conflicts";
        cf.textContent = "⚠ has conflicts";
        unresolvedEl.dd.after(cf);
      }
      renderDescription(info);

      // one line saying who is merging what into where, and when — the same
      // summary GitLab and GitHub put under the request title, sized for the bar
      if (info.sourceBranch || info.state) {
        const row = document.createElement("span");
        row.id = "pt-branches";

        if (info.state) {
          const chip = document.createElement(info.webUrl ? "a" : "span") as HTMLAnchorElement;
          chip.className = "pt-state";
          chip.dataset.state = info.state;
          chip.textContent = STATE_LABEL[info.state];
          if (info.webUrl) {
            chip.href = info.webUrl;
            chip.title = `Back to the ${P.kind === "gitlab" ? "merge" : "pull"} request — ${info.title}`;
          }
          row.appendChild(chip);
        }
        if (info.author) {
          const who = document.createElement("span");
          who.className = "pt-branch-author";
          who.textContent = info.author;
          row.appendChild(who);
        }
        if (info.sourceBranch) {
          const verb = document.createElement("span");
          verb.className = "pt-branch-dim";
          verb.textContent = "merging";
          const src = document.createElement("span");
          src.className = "pt-branch-src";
          src.textContent = info.sourceBranch;
          src.title = info.sourceBranch;
          const copy = document.createElement("button");
          copy.type = "button";
          copy.className = "pt-hbtn pt-branch-copy";
          copy.title = "Copy branch name";
          copy.innerHTML = icons.copy || "";
          copy.addEventListener("click", () => {
            navigator.clipboard.writeText(info.sourceBranch!);
            status("branch name copied");
          });
          row.append(verb, src, copy);
          if (info.targetBranch) {
            const into = document.createElement("span");
            into.className = "pt-branch-dim";
            into.textContent = "into";
            const tgt = document.createElement("span");
            tgt.className = "pt-branch-tgt";
            tgt.textContent = info.targetBranch;
            tgt.title = info.targetBranch;
            row.append(into, tgt);
          }
        }
        if (info.createdAt) {
          const dot = document.createElement("span");
          dot.className = "pt-branch-dim";
          dot.textContent = "·";
          row.appendChild(dot);
          const when = document.createElement("span");
          when.className = "pt-branch-dim";
          when.textContent = relativeTime(info.createdAt);
          when.title = new Date(info.createdAt).toLocaleString();
          row.appendChild(when);
        }
        unresolvedEl.dd.after(row);
      }
    } catch (e: any) {
      status(`info unavailable: ${e.message}`, true);
    }

    const decorateHeaders = () => {
      if (!refs) return;
      for (const sec of document.querySelectorAll(".pt-file")) {
        if (sec.querySelector(".pt-blob-link")) continue;
        const url = P.blobUrl((sec as HTMLElement).dataset.path!);
        if (!url) continue;
        const a = document.createElement("a");
        a.className = "pt-hbtn pt-blob-link";
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = "Open at head revision";
        a.innerHTML = icons.external || "↗";
        sec.querySelector(".pt-stats")?.before(a);
      }
    };
    decorateHeaders();
    const origRender = view.renderDiff;
    view.renderDiff = (t: string) => {
      origRender(t);
      decorateHeaders();
    };

    try {
      me = await P.me();
      setApproved(await P.approvedByMe(me!.id));
    } catch {
      // approval state is cosmetic; token may be missing
    }

    refreshThreads();

    view.root.addEventListener("click", onLineClick);
    view.root.addEventListener("mousedown", onLineMouseDown);
    document.addEventListener("mousemove", onDocMouseMove);
    document.addEventListener("mouseup", onDocMouseUp);
  }

  setup();
}
