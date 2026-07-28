// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
"use strict";

const LANG_BY_EXT = {
  go: "go",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "bash",
  bash: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  c: "c",
  h: "c",
  rs: "rust",
  css: "css",
  html: "html",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  java: "java",
  rb: "ruby",
  php: "php",
  cs: "c_sharp",
  lua: "lua",
  toml: "toml",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
};

// Highlighting is skipped for sides bigger than this to keep the page responsive.
const MAX_HIGHLIGHT_CHARS = 300 * 1024;

let viewedSet = new Set();
let saveViewed = () => {};

function langFor(path) {
  if (!path) return null;
  const base = path.split("/").pop();
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  return LANG_BY_EXT[ext] || null;
}

// Helm/Go templates: .tpl is always a template; a .yaml/.yml carrying
// {{ … }} actions is highlighted as a template too (yaml text stays plain,
// the actions get colored), everything else keeps its yaml highlighting.
function resolveLang(path, text) {
  const p = path || "";
  const name = p.split("/").pop().toLowerCase();
  // always-templated files: helm .tpl, werf configs
  if (/\.tpl$/i.test(p) || name === "werf.yaml" || /\.?werf\.inc\.yaml$/.test(name))
    return "gotmpl";
  const base = langFor(path);
  if (base === "yaml" && /\{\{.*?\}\}/s.test(text || "")) return "gotmpl";
  return base;
}

function parseDiff(text) {
  const lines = text.split("\n");
  const files = [];
  let preamble = [];
  let file = null;
  let hunk = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      file = { header: [line], oldPath: null, newPath: null, hunks: [], binary: false };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) {
      preamble.push(line);
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (m) {
        hunk = { oldStart: +m[1], newStart: +m[2], context: m[3], lines: [] };
        file.hunks.push(hunk);
        continue;
      }
    }
    if (!hunk) {
      if (line.startsWith("--- a/")) file.oldPath = line.slice(6);
      else if (line.startsWith("+++ b/")) file.newPath = line.slice(6);
      else if (line.startsWith("new file mode")) file.isNew = true;
      else if (line.startsWith("deleted file mode")) file.isDeleted = true;
      else if (line.startsWith("Binary files") || line === "GIT binary patch") file.binary = true;
      file.header.push(line);
      continue;
    }
    if (line.startsWith("+")) hunk.lines.push({ t: "+", s: line.slice(1) });
    else if (line.startsWith("-")) hunk.lines.push({ t: "-", s: line.slice(1) });
    else if (line.startsWith(" ") || line === "") hunk.lines.push({ t: " ", s: line.slice(1) });
    else if (line.startsWith("\\")) hunk.lines.push({ t: "\\", s: line });
    else {
      hunk = null;
      file.header.push(line);
    }
  }
  return { preamble: preamble.join("\n").trim(), files };
}

// Pair up deletions with the additions that replaced them so the split view
// can show them side by side; context lines pair with themselves.
function alignHunk(h) {
  const pairs = [];
  let dels = [];
  let adds = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) pairs.push({ old: dels[i] || null, new: adds[i] || null });
    dels = [];
    adds = [];
  };
  let oldNo = h.oldStart;
  let newNo = h.newStart;
  for (const l of h.lines) {
    if (l.t === "\\") continue;
    if (l.t === "-") dels.push({ no: oldNo++, text: l.s, other: newNo });
    else if (l.t === "+") adds.push({ no: newNo++, text: l.s, other: oldNo });
    else {
      flush();
      pairs.push({ old: { no: oldNo++, text: l.s }, new: { no: newNo++, text: l.s }, ctx: true });
    }
  }
  flush();
  return pairs;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderLineHTML(text, ranges, bg) {
  const colors = [];
  if (ranges?.length) {
    let pos = 0;
    for (const r of ranges.slice().sort((a, b) => a.s - b.s || b.e - a.e)) {
      if (r.s < pos) continue;
      const s = Math.max(0, Math.min(r.s, text.length));
      const e = Math.max(s, Math.min(r.e, text.length));
      if (e > s) colors.push({ s, e, c: r.c });
      pos = e;
    }
  }
  if (!colors.length && !bg?.length) return esc(text);

  const cuts = new Set([0, text.length]);
  for (const r of colors) {
    cuts.add(r.s);
    cuts.add(r.e);
  }
  for (const r of bg || []) {
    cuts.add(Math.max(0, Math.min(r.s, text.length)));
    cuts.add(Math.max(0, Math.min(r.e, text.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = "";
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (e <= s) continue;
    const cls = [];
    const color = colors.find((r) => r.s <= s && r.e >= e);
    if (color) cls.push(`pt-${color.c}`);
    const bgr = bg?.find((r) => r.s <= s && r.e >= e);
    if (bgr) cls.push(`pt-${bgr.c}`);
    out += cls.length
      ? `<span class="${cls.join(" ")}">${esc(text.slice(s, e))}</span>`
      : esc(text.slice(s, e));
  }
  return out;
}

// intra-line diff: LCS over word tokens, changed spans get a stronger tint
function wordDiff(a, b) {
  const tokenize = (s) => {
    const out = [];
    for (const m of s.matchAll(/\w+|\s+|[^\w\s]/g)) out.push({ t: m[0], s: m.index });
    return out;
  };
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.length || !B.length || A.length * B.length > 40000) return null;

  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i].t === B[j].t ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const keepA = new Array(A.length).fill(false);
  const keepB = new Array(B.length).fill(false);
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < A.length && j < B.length) {
    if (A[i].t === B[j].t) {
      keepA[i] = keepB[j] = true;
      common++;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  if (common / Math.max(A.length, B.length) < 0.3) return null;

  const ranges = (toks, keep, cls) => {
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      if (keep[k]) continue;
      const s = toks[k].s;
      const e = s + toks[k].t.length;
      const last = out[out.length - 1];
      if (last && last.e === s) last.e = e;
      else out.push({ s, e, c: cls });
    }
    return out;
  };
  return { a: ranges(A, keepA, "word-del"), b: ranges(B, keepB, "word-add") };
}

function makeTable(widths) {
  const table = document.createElement("table");
  const colgroup = document.createElement("colgroup");
  for (const w of widths) {
    const col = document.createElement("col");
    if (w) col.style.width = w;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);
  return table;
}

function setCtxMeta(tr, meta, o, n) {
  tr.dataset.path = meta.path;
  tr.dataset.oldPath = meta.oldPath;
  tr.dataset.old = o;
  tr.dataset.new = n;
  tr.dataset.ctx = "1";
  tr.dataset.codeOld = o;
  tr.dataset.codeNew = n;
}

function ctxRowU(meta, o, n, text) {
  const tr = document.createElement("tr");
  tr.className = "pt-ctx pt-exp";
  const t1 = tr.insertCell();
  t1.className = "pt-no";
  t1.textContent = o;
  const t2 = tr.insertCell();
  t2.className = "pt-no";
  t2.textContent = n;
  tr.insertCell().className = "pt-mark";
  const t4 = tr.insertCell();
  t4.className = "pt-code";
  t4.textContent = text;
  setCtxMeta(tr, meta, o, n);
  return tr;
}

function ctxRowS(meta, o, n, text) {
  const tr = document.createElement("tr");
  tr.className = "pt-srow pt-exp";
  const mk = (no, txt) => {
    const tn = tr.insertCell();
    tn.className = "pt-no pt-ctx-no";
    tn.textContent = no;
    const tc = tr.insertCell();
    tc.className = "pt-code pt-ctx-code";
    tc.textContent = txt;
  };
  mk(o, text);
  mk(n, text);
  setCtxMeta(tr, meta, o, n);
  return tr;
}

async function expandGap(view, ex) {
  if (ex.busy || ex.done) return;
  ex.busy = true;
  try {
    if (!window.ptView?.fetchFile) throw new Error("file contents unavailable here");
    const lines = await window.ptView.fetchFile(view.path);
    const to = Math.min(ex.newTo, lines.length);
    const cellsArr = [];
    for (let n = ex.newFrom; n <= to; n++) {
      const o = ex.oldFrom + (n - ex.newFrom);
      const text = lines[n - 1] ?? "";
      const u = ctxRowU(view.meta, o, n, text);
      ex.u.before(u);
      const tds = [u.cells[3]];
      if (ex.s) {
        const s = ctxRowS(view.meta, o, n, text);
        ex.s.before(s);
        tds.push(s.cells[1], s.cells[3]);
      }
      cellsArr.push({ tds, text });
    }
    // a fully expanded gap makes the following @@ header redundant noise
    if (to === ex.newTo) {
      for (const t of [ex.u.nextElementSibling, ex.s?.nextElementSibling])
        if (t?.classList.contains("pt-hunk")) t.remove();
    }
    ex.u.remove();
    ex.s?.remove();
    ex.done = true;
    if (view.lang && cellsArr.length)
      highlightSide(view.lang, cellsArr.map((c) => c.text).join("\n"), cellsArr);
  } catch (e) {
    ex.busy = false;
    ex.u.cells[0].textContent = `⚠ ${e.message}`;
  }
}

function hunkRow(table, span, h) {
  const tr = table.insertRow();
  tr.className = "pt-hunk";
  const td = tr.insertCell();
  td.colSpan = span;
  td.textContent = `@@ -${h.oldStart} +${h.newStart} @@${h.context}`;
}

// @font-face lives here, not in the injected CSS: extension-resource URLs
// need runtime.getURL to work on both chrome-extension:// and moz-extension://
const FONT_FACES = [
  ["JetBrains Mono", "400", "normal", "JetBrainsMono-Regular.woff2"],
  ["JetBrains Mono", "400", "italic", "JetBrainsMono-Italic.woff2"],
  ["JetBrains Mono", "700", "normal", "JetBrainsMono-Bold.woff2"],
  ["Inter", "100 900", "normal", "InterVariable.woff2"],
  ["Inter", "100 900", "italic", "InterVariable-Italic.woff2"],
  ["JetBrainsMono Nerd Font Mono", "400", "normal", "JetBrainsMonoNerdFontMono-Regular.woff2"],
  ["JetBrainsMono Nerd Font Mono", "700", "normal", "JetBrainsMonoNerdFontMono-Bold.woff2"],
  ["FiraCode Nerd Font Mono", "400", "normal", "FiraCodeNerdFontMono-Regular.woff2"],
  ["FiraCode Nerd Font Mono", "700", "normal", "FiraCodeNerdFontMono-Bold.woff2"],
  ["Hack Nerd Font Mono", "400", "normal", "HackNerdFontMono-Regular.woff2"],
  ["Hack Nerd Font Mono", "700", "normal", "HackNerdFontMono-Bold.woff2"],
  ["MesloLGS Nerd Font Mono", "400", "normal", "MesloLGSNerdFontMono-Regular.woff2"],
  ["MesloLGS Nerd Font Mono", "700", "normal", "MesloLGSNerdFontMono-Bold.woff2"],
  ["Iosevka Nerd Font Mono", "400", "normal", "IosevkaNerdFontMono-Regular.woff2"],
  ["Iosevka Nerd Font Mono", "700", "normal", "IosevkaNerdFontMono-Bold.woff2"],
];

function injectFonts() {
  const css = FONT_FACES.map(
    ([family, weight, style, file]) =>
      `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};` +
      `src:url("${chrome.runtime.getURL("fonts/" + file)}") format("woff2");}`
  ).join("\n");
  const el = document.createElement("style");
  el.textContent = css;
  document.documentElement.appendChild(el);
}

const GENERATED_RE =
  /(^|\/)(go\.sum|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$|\.pb\.go$|zz_generated|\.generated\.|\.min\.(js|css)$|\.map$|(^|\/)vendor\//;

function buildFileView(file) {
  const section = document.createElement("section");
  section.className = "pt-file";

  const path = file.newPath || file.oldPath || "(unknown)";
  section.dataset.path = path;
  let adds = 0;
  let dels = 0;
  for (const h of file.hunks)
    for (const l of h.lines) {
      if (l.t === "+") adds++;
      else if (l.t === "-") dels++;
    }

  const header = document.createElement("div");
  header.className = "pt-file-header";
  const generated = GENERATED_RE.test(path);
  header.innerHTML =
    `<span class="pt-fold">${window.ptIcons.chevron}</span>` +
    `<span class="pt-path">${esc(path)}</span>` +
    `<button class="pt-hbtn" title="Copy path">${window.ptIcons.copy}</button>` +
    (file.oldPath && file.newPath && file.oldPath !== file.newPath
      ? `<span class="pt-rename">← ${esc(file.oldPath)}</span>`
      : "") +
    (generated ? `<span class="pt-gen-badge">generated</span>` : "") +
    `<span class="pt-stats"><span class="pt-adds">+${adds}</span> <span class="pt-dels">−${dels}</span></span>`;
  section.appendChild(header);
  header.querySelector(".pt-hbtn").addEventListener("click", () => {
    navigator.clipboard.writeText(path);
  });

  const view = { section, path, adds, dels, cells: null, texts: null, lang: langFor(path) };

  const setFolded = (f) => {
    section.classList.toggle("pt-folded", f);
  };

  const fullLab = document.createElement("label");
  fullLab.className = "pt-viewed pt-fullfile";
  const fullCb = document.createElement("input");
  fullCb.type = "checkbox";
  fullLab.append(fullCb, "Full file");
  header.appendChild(fullLab);
  fullCb.addEventListener("change", () => {
    section.classList.toggle("pt-exp-hide", !fullCb.checked);
    section.classList.toggle("pt-hunks-hidden", fullCb.checked);
    if (fullCb.checked) for (const ex of view.expanders) expandGap(view, ex);
  });

  const viewedLab = document.createElement("label");
  viewedLab.className = "pt-viewed";
  const viewedCb = document.createElement("input");
  viewedCb.type = "checkbox";
  viewedCb.checked = viewedSet.has(path);
  viewedLab.append(viewedCb, "Viewed");
  header.appendChild(viewedLab);
  if (viewedCb.checked) setFolded(true);

  viewedCb.addEventListener("change", () => {
    if (viewedCb.checked) viewedSet.add(path);
    else viewedSet.delete(path);
    saveViewed();
    setFolded(viewedCb.checked);
    view.treeLink?.classList.toggle("pt-viewed-file", viewedCb.checked);
    window.ptUpdateProgress?.();
  });

  header.addEventListener("click", (e) => {
    if (e.target.closest(".pt-viewed, .pt-fullfile, .pt-hbtn, a")) return;
    setFolded(!section.classList.contains("pt-folded"));
  });

  if (generated && !viewedCb.checked) setFolded(true);
  if (file.binary) {
    const p = document.createElement("div");
    p.className = "pt-binary";
    p.textContent = "binary file";
    section.appendChild(p);
    return view;
  }

  // cells[side][row] -> {tds: [], text}; row indexes the reconstructed
  // old/new side texts sent to tree-sitter, tds live in both tables
  const cells = { old: [], new: [] };
  const oldParts = [];
  const newParts = [];

  const unified = makeTable(["44px", "44px", "16px", ""]);
  unified.className = "pt-table pt-unified";
  // a fully added/deleted file has one real side — the split view would waste
  // half the width, so it falls back to the unified table at full width
  const full = file.isNew || file.isDeleted;
  if (full) section.classList.add("pt-full");
  const split = full ? null : makeTable(["44px", "", "44px", ""]);
  if (split) split.className = "pt-table pt-split";

  const rowMeta = (tr, o, n, ctx) => {
    tr.dataset.path = file.newPath || file.oldPath || "";
    tr.dataset.oldPath = file.oldPath || "";
    if (o) tr.dataset.old = o.no;
    if (n) tr.dataset.new = n.no;
    if (ctx) tr.dataset.ctx = "1";
    // both-side counters as used by GitLab line codes (sha_old_new)
    tr.dataset.codeOld = o ? o.no : (n?.other ?? "");
    tr.dataset.codeNew = n ? n.no : (o?.other ?? "");
  };

  const regOld = (text, td) => {
    const row = cells.old.length;
    cells.old.push({ tds: td ? [td] : [], text });
    oldParts.push(text);
    return row;
  };
  const regNew = (text, td) => {
    const row = cells.new.length;
    cells.new.push({ tds: td ? [td] : [], text });
    newParts.push(text);
    return row;
  };

  const unifiedLine = (cls, o, n, text) => {
    const tr = unified.insertRow();
    tr.className = cls;
    const tdOld = tr.insertCell();
    tdOld.className = "pt-no";
    tdOld.textContent = o ? o.no : "";
    const tdNew = tr.insertCell();
    tdNew.className = "pt-no";
    tdNew.textContent = n ? n.no : "";
    const tdMark = tr.insertCell();
    tdMark.className = "pt-mark";
    tdMark.textContent = cls === "pt-add" ? "+" : cls === "pt-del" ? "-" : "";
    const td = tr.insertCell();
    td.className = "pt-code";
    td.textContent = text;
    rowMeta(tr, o, n, cls === "pt-ctx");
    return td;
  };

  const splitCell = (tr, entry, cls) => {
    const tdNo = tr.insertCell();
    tdNo.className = "pt-no" + (entry ? ` ${cls}-no` : " pt-void");
    const td = tr.insertCell();
    td.className = "pt-code" + (entry ? ` ${cls}-code` : " pt-void");
    if (entry) {
      tdNo.textContent = entry.no;
      td.textContent = entry.text;
    }
    return td;
  };

  view.meta = { path, oldPath: file.oldPath || "" };
  view.expanders = [];
  const canExpand = !full && !file.binary;
  const addExpander = (oldFrom, newFrom, newTo) => {
    const make = (table) => {
      const tr = table.insertRow();
      tr.className = "pt-expander";
      const td = tr.insertCell();
      td.colSpan = 4;
      td.innerHTML = `${window.ptIcons.unfold} <span>expand hidden lines</span>`;
      return tr;
    };
    const ex = { u: make(unified), s: split ? make(split) : null, oldFrom, newFrom, newTo };
    const onClick = () => expandGap(view, ex);
    ex.u.addEventListener("click", onClick);
    ex.s?.addEventListener("click", onClick);
    view.expanders.push(ex);
  };

  let nextOld = 1;
  let nextNew = 1;
  for (const h of file.hunks) {
    if (canExpand && h.newStart > nextNew)
      addExpander(nextOld, nextNew, h.newStart - 1);
    hunkRow(unified, 4, h);
    if (split) hunkRow(split, 4, h);
    let cntOld = 0;
    let cntNew = 0;
    for (const l of h.lines) {
      if (l.t !== "+" && l.t !== "\\") cntOld++;
      if (l.t !== "-" && l.t !== "\\") cntNew++;
    }
    nextOld = h.oldStart + cntOld;
    nextNew = h.newStart + cntNew;
    for (const pair of alignHunk(h)) {
      let oldTd = null;
      let newTd = null;
      if (split) {
        const str = split.insertRow();
        str.className = "pt-srow";
        rowMeta(str, pair.old, pair.new, pair.ctx);
        oldTd = splitCell(str, pair.old, pair.ctx ? "pt-ctx" : "pt-del");
        newTd = splitCell(str, pair.new, pair.ctx ? "pt-ctx" : "pt-add");
      }

      if (pair.ctx) {
        const utd = unifiedLine("pt-ctx", pair.old, pair.new, pair.new.text);
        const row = regNew(pair.new.text, utd);
        if (newTd) cells.new[row].tds.push(newTd);
        regOld(pair.old.text, oldTd);
      } else {
        const wd = pair.old && pair.new ? wordDiff(pair.old.text, pair.new.text) : null;
        if (pair.old) {
          const utd = unifiedLine("pt-del", pair.old, null, pair.old.text);
          const row = regOld(pair.old.text, utd);
          if (oldTd) cells.old[row].tds.push(oldTd);
          if (wd?.a.length) {
            cells.old[row].bg = wd.a;
            for (const td of cells.old[row].tds)
              td.innerHTML = renderLineHTML(pair.old.text, null, wd.a);
          }
        }
        if (pair.new) {
          const utd = unifiedLine("pt-add", null, pair.new, pair.new.text);
          const row = regNew(pair.new.text, utd);
          if (newTd) cells.new[row].tds.push(newTd);
          if (wd?.b.length) {
            cells.new[row].bg = wd.b;
            for (const td of cells.new[row].tds)
              td.innerHTML = renderLineHTML(pair.new.text, null, wd.b);
          }
        }
      }
    }
  }

  if (canExpand) addExpander(nextOld, nextNew, Infinity);

  section.appendChild(unified);
  if (split) section.appendChild(split);
  view.cells = cells;
  view.texts = { old: oldParts.join("\n"), new: newParts.join("\n") };
  view.lang = resolveLang(path, view.texts.new + "\n" + view.texts.old);
  return view;
}

async function highlightSide(lang, text, sideCells) {
  if (!lang || !text || text.length > MAX_HIGHLIGHT_CHARS) return;
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "highlight", lang, text });
  } catch {
    return;
  }
  if (!resp || !resp.rows) return;
  for (const [row, ranges] of Object.entries(resp.rows)) {
    const cell = sideCells[+row];
    if (!cell) continue;
    for (const td of cell.tds) td.innerHTML = renderLineHTML(cell.text, ranges, cell.bg);
  }
}

function buildTree(views) {
  const rootNode = { dirs: new Map(), files: [] };
  for (const v of views) {
    const parts = v.path.split("/");
    let node = rootNode;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(v);
  }

  const render = (node) => {
    const frag = document.createDocumentFragment();
    for (let [name, child] of [...node.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      while (child.dirs.size === 1 && child.files.length === 0) {
        const [subName, subChild] = child.dirs.entries().next().value;
        name += "/" + subName;
        child = subChild;
      }
      const det = document.createElement("details");
      det.open = true;
      const sum = document.createElement("summary");
      sum.textContent = name;
      det.appendChild(sum);
      det.appendChild(render(child));
      frag.appendChild(det);
    }
    for (const v of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
      const a = document.createElement("a");
      a.className = "pt-tree-file";
      a.href = "#";
      a.dataset.path = v.path.toLowerCase();
      a.innerHTML =
        `<span class="pt-tree-name">${esc(v.path.split("/").pop())}</span>` +
        `<span class="pt-tree-cmt"></span>` +
        `<span class="pt-tree-stats"><span class="pt-adds">+${v.adds}</span> <span class="pt-dels">−${v.dels}</span></span>`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (e.target.closest(".pt-tree-cmt")) {
          const row = [...v.section.querySelectorAll(".pt-comments-row")].find(
            (r) => r.offsetParent
          );
          if (row) {
            row.scrollIntoView({ block: "center" });
            row.classList.add("pt-flash");
            setTimeout(() => row.classList.remove("pt-flash"), 1200);
            return;
          }
        }
        v.section.scrollIntoView();
      });
      v.treeLink = a;
      if (viewedSet.has(v.path)) a.classList.add("pt-viewed-file");
      frag.appendChild(a);
    }
    return frag;
  };

  const frag = document.createDocumentFragment();
  frag.appendChild(render(rootNode));
  return frag;
}

function looksLikeDiff(text) {
  return /^(diff --git |From [0-9a-f]{40} |--- )/m.test(text.slice(0, 4096));
}

const SVG_ROWS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.75" y="2.75" width="12.5" height="4.1" rx="1.4"/><rect x="1.75" y="9.15" width="12.5" height="4.1" rx="1.4"/></svg>';
const SVG_COLS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.75" y="2.75" width="5.1" height="10.5" rx="1.4"/><rect x="9.15" y="2.75" width="5.1" height="10.5" rx="1.4"/></svg>';
const SVG_GEAR =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"/></svg>';

const octicon = (path, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;

window.ptIcons = {
  bold: octicon(
    "M4 2h4.5a3.501 3.501 0 0 1 2.852 5.53A3.499 3.499 0 0 1 9.5 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 7v3h4.5a1.5 1.5 0 0 0 0-3Zm3.5-2a1.5 1.5 0 0 0 0-3H5v3Z"
  ),
  italic: octicon(
    "M6 2.75A.75.75 0 0 1 6.75 2h6.5a.75.75 0 0 1 0 1.5h-2.505l-3.858 9H9.25a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.505l3.858-9H6.75A.75.75 0 0 1 6 2.75Z"
  ),
  heading: octicon(
    "M3.75 2a.75.75 0 0 1 .75.75V7h7V2.75a.75.75 0 0 1 1.5 0v10.5a.75.75 0 0 1-1.5 0V8.5h-7v4.75a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 3.75 2Z"
  ),
  code: octicon(
    "m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"
  ),
  ul: octicon(
    "M5.75 2.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-6a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM2 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
  ),
  ol: octicon(
    "M5 3.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 3.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 8.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75ZM.924 10.32a.5.5 0 0 1-.851-.525l.001-.001.001-.002.002-.004.007-.011a2 2 0 0 1 .348-.384c.228-.19.588-.392 1.068-.392.468 0 .858.181 1.126.484.259.294.377.673.377 1.038 0 .987-.686 1.495-1.156 1.845l-.047.035c-.303.225-.522.4-.654.597h1.357a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5c0-1.005.692-1.52 1.167-1.875l.035-.025c.531-.396.798-.625.798-1.077a.57.57 0 0 0-.128-.376C1.806 10.068 1.695 10 1.5 10a.658.658 0 0 0-.429.163.835.835 0 0 0-.144.153ZM2.003 2.5V6h.503a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1h.503V3.308l-.28.14a.5.5 0 0 1-.446-.895l1.003-.5a.5.5 0 0 1 .723.447Z"
  ),
  diff: octicon(
    "M8.75 1.75V5H12a.75.75 0 0 1 0 1.5H8.75v3.25a.75.75 0 0 1-1.5 0V6.5H4A.75.75 0 0 1 4 5h3.25V1.75a.75.75 0 0 1 1.5 0Zm-6.5 12h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1 0-1.5Z"
  ),
  unfold: octicon(
    "m8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z",
    12
  ),
  chevron: octicon(
    "M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z",
    12
  ),
  commit: octicon(
    "M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"
  ),
  reply: octicon(
    "M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A4.75 4.75 0 0 1 15 10.75v2.5a.75.75 0 0 1-1.5 0v-2.5a3.25 3.25 0 0 0-3.25-3.25H3.81l2.97 2.97a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L1.97 7.78a.75.75 0 0 1 0-1.06l3.75-3.75a.751.751 0 0 1 1.06 0Z",
    12
  ),
  comment: octicon(
    "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z",
    11
  ),
  check: octicon(
    "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z",
    12
  ),
};

window.ptIcons.copy =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
window.ptIcons.external =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/></svg>';

function makeDropdown(labelHTML) {
  const dd = document.createElement("details");
  dd.className = "pt-dd";
  const sum = document.createElement("summary");
  sum.innerHTML = labelHTML;
  const menu = document.createElement("div");
  menu.className = "pt-dd-menu";
  dd.append(sum, menu);
  return { dd, sum, menu };
}

function menuItem(menu, html, onClick) {
  const item = document.createElement("div");
  item.className = "pt-dd-item";
  item.innerHTML = html;
  item.addEventListener("click", () => onClick(item));
  menu.appendChild(item);
  return item;
}

// base16 palettes, base00..base0F
const BASE16 = {
  "Gruvbox Dark": "1d2021 3c3836 504945 665c54 bdae93 d5c4a1 ebdbb2 fbf1c7 fb4934 fe8019 fabd2f b8bb26 8ec07c 83a598 d3869b d65d0e",
  Nord: "2e3440 3b4252 434c5e 4c566a d8dee9 e5e9f0 eceff4 8fbcbb bf616a d08770 ebcb8b a3be8c 88c0d0 81a1c1 b48ead 5e81ac",
  Dracula: "282a36 363948 44475a 6272a4 9ea8c7 f8f8f2 f8f8f2 ffffff ff5555 ffb86c f1fa8c 50fa7b 8be9fd 61bfff bd93f9 ff79c6",
  "One Dark": "282c34 353b45 3e4451 545862 565c64 abb2bf b6bdca c8ccd4 e06c75 d19a66 e5c07b 98c379 56b6c2 61afef c678dd be5046",
  "Tomorrow Night": "1d1f21 282a2e 373b41 969896 b4b7b4 c5c8c6 e0e0e0 ffffff cc6666 de935f f0c674 b5bd68 8abeb7 81a2be b294bb a3685a",
  "Solarized Dark": "002b36 073642 586e75 657b83 839496 93a1a1 eee8d5 fdf6e3 dc322f cb4b16 b58900 859900 2aa198 268bd2 6c71c4 d33682",
  "Solarized Light": "fdf6e3 eee8d5 93a1a1 839496 657b83 586e75 073642 002b36 dc322f cb4b16 b58900 859900 2aa198 268bd2 6c71c4 d33682",
  "Default Dark": "181818 282828 383838 585858 b8b8b8 d8d8d8 e8e8e8 f8f8f8 ab4642 dc9656 f7ca88 a1b56c 86c1b9 7cafc2 ba8baf a16946",
};

function hexRgba(hex, a) {
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const THEME_VARS = (c) => ({
  bg: `#${c[0]}`,
  fg: `#${c[5]}`,
  muted: `#${c[4]}`,
  border: `#${c[2]}`,
  "header-bg": `#${c[1]}`,
  "add-bg": hexRgba(c[11], 0.14),
  "add-no-bg": hexRgba(c[11], 0.35),
  "del-bg": hexRgba(c[8], 0.12),
  "del-no-bg": hexRgba(c[8], 0.3),
  "hunk-bg": hexRgba(c[13], 0.12),
  "hunk-fg": `#${c[4]}`,
  "word-add": hexRgba(c[11], 0.38),
  "word-del": hexRgba(c[8], 0.38),
  keyword: `#${c[14]}`,
  string: `#${c[11]}`,
  comment: `#${c[3]}`,
  function: `#${c[13]}`,
  type: `#${c[10]}`,
  constant: `#${c[9]}`,
  number: `#${c[9]}`,
  variable: `#${c[8]}`,
  property: `#${c[13]}`,
  operator: `#${c[5]}`,
  tag: `#${c[8]}`,
  attribute: `#${c[10]}`,
  punctuation: `#${c[4]}`,
  embedded: `#${c[15]}`,
  escape: `#${c[12]}`,
  label: `#${c[10]}`,
  module: `#${c[10]}`,
});

function applySettings(s) {
  const st = document.documentElement.style;
  if (s.uiFont) st.setProperty("--pt-ui", `"${s.uiFont}", system-ui, sans-serif`);
  else st.removeProperty("--pt-ui");
  if (s.codeFont) st.setProperty("--pt-mono", `"${s.codeFont}", ui-monospace, monospace`);
  else st.removeProperty("--pt-mono");
  st.setProperty("--pt-tab", s.tabSize || 4);
  st.setProperty("--pt-size", (s.fontSize || 14) + "px");
  st.setProperty("--pt-ui-size", (s.uiFontSize || 14) + "px");
  st.setProperty("--pt-comment-style", s.noItalic ? "normal" : "italic");
  st.setProperty("--pt-liga", s.noLigatures ? '"calt" 0, "liga" 0' : "normal");

  const palette = BASE16[s.theme] || window.ptCustomThemes?.[s.theme] || s.themePalette;
  const vars = palette ? THEME_VARS(palette.split(" ")) : null;
  for (const k of Object.keys(THEME_VARS(BASE16["Default Dark"].split(" ")))) {
    if (vars) st.setProperty(`--pt-${k}`, vars[k]);
    else st.removeProperty(`--pt-${k}`);
  }
}

function applyTreeFilter(list, query, views) {
  const q = query.trim().toLowerCase();
  const contentMatch = new Set();
  if (q.length >= 3 && views)
    for (const v of views)
      if (v.texts?.new.toLowerCase().includes(q) || v.texts?.old.toLowerCase().includes(q))
        contentMatch.add(v.path.toLowerCase());
  for (const a of list.querySelectorAll(".pt-tree-file"))
    a.style.display =
      !q || a.dataset.path.includes(q) || contentMatch.has(a.dataset.path) ? "" : "none";
  for (const det of [...list.querySelectorAll("details")].reverse()) {
    const visible = [...det.querySelectorAll(".pt-tree-file")].some((a) => a.style.display !== "none");
    det.style.display = visible ? "" : "none";
  }
}

async function main() {
  if (document.contentType !== "text/plain") return;
  const raw = document.body.innerText;
  if (!looksLikeDiff(raw)) return;
  if (parseDiff(raw).files.length === 0) return;

  injectFonts();

  const viewedKey = `viewed:${location.host}${location.pathname}`;
  const stored = await chrome.storage.local.get(viewedKey);
  viewedSet = new Set(stored[viewedKey] || []);
  saveViewed = () => chrome.storage.local.set({ [viewedKey]: [...viewedSet] });

  const root = document.createElement("div");
  root.id = "pt-root";

  const bar = document.createElement("div");
  bar.id = "pt-bar";
  root.appendChild(bar);

  const tree = document.createElement("nav");
  tree.id = "pt-tree";
  const filter = document.createElement("input");
  filter.id = "pt-filter";
  filter.type = "search";
  filter.placeholder = "Filter files…";
  const treeList = document.createElement("div");
  treeList.id = "pt-tree-list";
  tree.append(filter, treeList);
  root.appendChild(tree);
  filter.addEventListener("input", () => applyTreeFilter(treeList, filter.value, views));

  const splitter = document.createElement("div");
  splitter.id = "pt-splitter";
  root.appendChild(splitter);

  const main = document.createElement("div");
  main.id = "pt-main";
  root.appendChild(main);

  const { treeWidth } = await chrome.storage.sync.get("treeWidth");
  if (treeWidth) tree.style.width = treeWidth + "px";
  splitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const left = tree.getBoundingClientRect().left;
    document.body.style.userSelect = "none";
    let pending = 0;
    const move = (ev) => {
      const w = Math.max(160, Math.min(800, ev.clientX - left));
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        tree.style.width = w + "px";
      });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      chrome.storage.sync.set({ treeWidth: tree.getBoundingClientRect().width });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  const rawPre = document.createElement("pre");
  rawPre.id = "pt-raw";
  rawPre.style.display = "none";

  let views = [];

  function renderDiff(text) {
    const parsed = parseDiff(text);
    rawPre.textContent = text;
    main.textContent = "";
    treeList.textContent = "";

    if (parsed.preamble) {
      const pre = document.createElement("pre");
      pre.id = "pt-preamble";
      pre.textContent = parsed.preamble;
      main.appendChild(pre);
    }

    views = parsed.files.map(buildFileView);
    treeList.appendChild(buildTree(views));
    applyTreeFilter(treeList, filter.value, views);
    for (const v of views) main.appendChild(v.section);
    window.ptUpdateProgress?.();

    for (const v of views) {
      if (!v.cells || !v.lang) continue;
      highlightSide(v.lang, v.texts.new, v.cells.new);
      highlightSide(v.lang, v.texts.old, v.cells.old);
    }
  }

  const { view: savedView = "unified" } = await chrome.storage.sync.get("view");

  const progress = document.createElement("span");
  progress.id = "pt-progress";
  bar.appendChild(progress);
  window.ptUpdateProgress = () => {
    const done = views.filter((v) => viewedSet.has(v.path)).length;
    progress.textContent = `${done}/${views.length} viewed`;
    progress.classList.toggle("pt-done", done === views.length && views.length > 0);
  };

  const seg = document.createElement("div");
  seg.className = "pt-seg";
  const segInline = document.createElement("button");
  segInline.innerHTML = SVG_ROWS;
  segInline.title = "Inline";
  const segSplit = document.createElement("button");
  segSplit.innerHTML = SVG_COLS;
  segSplit.title = "Side-by-side";
  seg.append(segInline, segSplit);
  bar.appendChild(seg);

  const setMode = (mode) => {
    root.classList.toggle("pt-mode-split", mode === "split");
    root.classList.toggle("pt-mode-unified", mode !== "split");
    segInline.classList.toggle("pt-active", mode !== "split");
    segSplit.classList.toggle("pt-active", mode === "split");
  };
  setMode(savedView);
  segInline.addEventListener("click", () => {
    setMode("unified");
    chrome.storage.sync.set({ view: "unified" });
  });
  segSplit.addEventListener("click", () => {
    setMode("split");
    chrome.storage.sync.set({ view: "split" });
  });

  const gear = makeDropdown(SVG_GEAR);
  gear.dd.classList.add("pt-dd-right");
  gear.dd.id = "pt-settings";
  gear.sum.title = "Settings";
  bar.appendChild(gear.dd);

  const { settings = {} } = await chrome.storage.sync.get("settings");
  applySettings(settings);
  const saveSettings = () => chrome.storage.sync.set({ settings });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "sync" && ch.settings) applySettings(ch.settings.newValue || {});
  });

  const buildRow = (labelText, control) => {
    const row = document.createElement("label");
    row.className = "pt-set-row";
    const span = document.createElement("span");
    span.textContent = labelText;
    row.append(span, control);
    return row;
  };
  const setRow = (labelText, control) => gear.menu.appendChild(buildRow(labelText, control));

  const { customThemes = {} } = await chrome.storage.sync.get("customThemes");
  window.ptCustomThemes = customThemes;

  const themeSel = document.createElement("select");
  const rebuildThemeOptions = () => {
    themeSel.textContent = "";
    const names = ["GitHub", ...Object.keys(BASE16), ...Object.keys(customThemes)];
    if (settings.theme && settings.themePalette && !names.includes(settings.theme))
      names.push(settings.theme);
    for (const name of names) themeSel.append(new Option(name, name));
    themeSel.value = names.includes(settings.theme) && settings.theme ? settings.theme : "GitHub";
  };
  rebuildThemeOptions();
  themeSel.addEventListener("change", () => {
    settings.theme = themeSel.value === "GitHub" ? "" : themeSel.value;
    settings.themePalette = "";
    applySettings(settings);
    saveSettings();
  });
  setRow("Theme", themeSel);

  // tinted-theming base16 yaml: base00..base0F hex values + scheme/name field
  const parseBase16Yaml = (text) => {
    const colors = [];
    for (let i = 0; i < 16; i++) {
      const key = `base0${i.toString(16).toUpperCase()}`;
      const m = new RegExp(`${key}:\\s*["']?#?([0-9a-fA-F]{6})`).exec(text);
      if (!m) return null;
      colors.push(m[1].toLowerCase());
    }
    const name =
      /(?:scheme|name):\s*["']?([^"'\n]+)/.exec(text)?.[1]?.trim() || "custom scheme";
    return { name, colors: colors.join(" ") };
  };

  const applyTheme = (name, palette) => {
    settings.theme = name;
    settings.themePalette = palette;
    applySettings(settings);
    saveSettings();
    rebuildThemeOptions();
  };

  const themeCard = (t) => {
    const c = t.palette.split(" ");
    const card = document.createElement("div");
    card.className = "pt-theme-card";
    card.dataset.name = t.name.toLowerCase();
    card.dataset.variant = t.variant;
    const span = (color, text) => `<span style="color:#${color}">${esc(text)}</span>`;
    card.innerHTML =
      `<pre class="pt-theme-sample" style="background:#${c[0]};color:#${c[5]}">` +
      `${span(c[3], "// load and apply a scheme")}\n` +
      `${span(c[14], "fn")} ${span(c[13], "apply")}(${span(c[8], "name")}: ${span(c[10], "&str")}) {\n` +
      `  ${span(c[14], "let")} theme = scheme.${span(c[13], "with_base")}(${span(c[9], "16")});\n` +
      `  ${span(c[13], "println!")}(${span(c[11], '"applied: {}"')}, name);\n` +
      `}</pre>` +
      `<div class="pt-theme-meta"><b>${esc(t.name)}</b>` +
      `<span class="pt-theme-badges">${t.system === "base24" ? "<i>BASE24</i>" : ""}<i>${t.variant.toUpperCase()}</i></span></div>`;
    if (settings.theme === t.name) card.classList.add("pt-active");
    card.addEventListener("click", () => {
      applyTheme(t.name, t.palette);
      for (const el of card.parentNode.querySelectorAll(".pt-theme-card.pt-active"))
        el.classList.remove("pt-active");
      card.classList.add("pt-active");
    });
    return card;
  };

  const openThemesDialog = async () => {
    document.getElementById("pt-themes-dialog")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "pt-themes-dialog";
    const panel = document.createElement("div");
    panel.className = "pt-dialog pt-gallery";

    const head = document.createElement("div");
    head.className = "pt-gallery-head";
    head.innerHTML = `<h3>Theme gallery</h3>`;
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search themes…";
    const variantSel = document.createElement("select");
    for (const v of ["all", "dark", "light"]) variantSel.append(new Option(v, v));
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => overlay.remove());
    head.append(search, variantSel, closeBtn);
    panel.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "pt-theme-grid";
    panel.appendChild(grid);

    const all = ((await chrome.runtime.sendMessage({ type: "themes" })) || []).filter(
      (t) => t?.palette && t?.name
    );
    if (!all.length) grid.textContent = "themes.json missing — run make themes and reload";

    // 500+ cards of styled <pre> freeze layout if rendered at once —
    // render in batches as the grid scrolls
    const BATCH = 48;
    let filtered = all;
    let rendered = 0;
    const sentinel = document.createElement("div");
    sentinel.className = "pt-gallery-sentinel";
    grid.appendChild(sentinel);
    const renderBatch = () => {
      const frag = document.createDocumentFragment();
      for (const t of filtered.slice(rendered, rendered + BATCH)) frag.appendChild(themeCard(t));
      rendered = Math.min(rendered + BATCH, filtered.length);
      grid.insertBefore(frag, sentinel);
    };
    new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && rendered < filtered.length) renderBatch();
      },
      { root: grid, rootMargin: "300px" }
    ).observe(sentinel);
    renderBatch();

    const applyFilter = () => {
      const q = search.value.trim().toLowerCase();
      const v = variantSel.value;
      filtered = all.filter(
        (t) =>
          (!q || t.name.toLowerCase().includes(q)) && (v === "all" || t.variant === v)
      );
      for (const c of grid.querySelectorAll(".pt-theme-card")) c.remove();
      rendered = 0;
      renderBatch();
    };
    search.addEventListener("input", applyFilter);
    variantSel.addEventListener("change", applyFilter);

    const foot = document.createElement("details");
    foot.className = "pt-gallery-custom";
    foot.innerHTML =
      `<summary>Paste a custom scheme yaml (base16/base24)</summary>` +
      `<p>Any <a href="https://github.com/tinted-theming/schemes" target="_blank" rel="noopener">tinted-theming</a>-format scheme works.</p>`;
    const ta = document.createElement("textarea");
    ta.rows = 6;
    ta.placeholder = 'name: "My Scheme"\nbase00: "131513"\n…';
    const err = document.createElement("p");
    err.className = "pt-dialog-err";
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add and apply";
    addBtn.className = "pt-primary";
    addBtn.addEventListener("click", async () => {
      const parsed = parseBase16Yaml(ta.value);
      if (!parsed) {
        err.textContent = "could not find all base00…base0F colors";
        return;
      }
      err.textContent = "";
      customThemes[parsed.name] = parsed.colors;
      await chrome.storage.sync.set({ customThemes });
      applyTheme(parsed.name, parsed.colors);
      ta.value = "";
    });
    foot.append(ta, err, addBtn);
    panel.appendChild(foot);

    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    search.focus();
  };

  menuItem(gear.menu, "Theme gallery…", () => {
    gear.dd.open = false;
    openThemesDialog();
  });

  const fontControl = (key, bundled) => {
    const wrap = document.createElement("span");
    wrap.className = "pt-font-ctl";
    const sel = document.createElement("select");
    sel.append(new Option("Default", ""));
    for (const f of bundled) {
      const o = new Option(f, f);
      o.style.fontFamily = `"${f}"`;
      sel.append(o);
    }
    sel.append(new Option("Custom…", "__custom"));
    const input = document.createElement("input");
    input.placeholder = "system font name";
    input.style.display = "none";

    const current = settings[key] || "";
    if (bundled.includes(current)) sel.value = current;
    else if (current) {
      sel.value = "__custom";
      input.value = current;
      input.style.display = "";
    }
    sel.style.fontFamily = bundled.includes(current) ? `"${current}"` : "";

    const save = (v) => {
      settings[key] = v;
      applySettings(settings);
      saveSettings();
    };
    sel.addEventListener("change", () => {
      if (sel.value === "__custom") {
        input.style.display = "";
        input.focus();
      } else {
        input.style.display = "none";
        sel.style.fontFamily = sel.value ? `"${sel.value}"` : "";
        save(sel.value);
      }
    });
    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => save(input.value.trim()), 400);
    });
    wrap.append(sel, input);
    return wrap;
  };
  setRow("UI font", fontControl("uiFont", ["Inter"]));
  setRow(
    "Code font",
    fontControl("codeFont", [
      "JetBrains Mono",
      "JetBrainsMono Nerd Font Mono",
      "FiraCode Nerd Font Mono",
      "Hack Nerd Font Mono",
      "MesloLGS Nerd Font Mono",
      "Iosevka Nerd Font Mono",
    ])
  );

  const tabSel = document.createElement("select");
  for (const n of [2, 4, 8]) tabSel.append(new Option(n, n));
  tabSel.value = settings.tabSize || 4;
  tabSel.addEventListener("change", () => {
    settings.tabSize = +tabSel.value;
    applySettings(settings);
    saveSettings();
  });
  setRow("Tab width", tabSel);

  const sizeRow = (label, key, dflt) => {
    const input = document.createElement("input");
    input.type = "number";
    input.min = 9;
    input.max = 20;
    input.value = settings[key] || dflt;
    input.addEventListener("change", () => {
      settings[key] = Math.max(9, Math.min(20, +input.value || dflt));
      input.value = settings[key];
      applySettings(settings);
      saveSettings();
    });
    setRow(label, input);
  };
  sizeRow("Code font size", "fontSize", 14);
  sizeRow("UI font size", "uiFontSize", 14);

  const italicCb = document.createElement("input");
  italicCb.type = "checkbox";
  italicCb.checked = !settings.noItalic;
  italicCb.addEventListener("change", () => {
    settings.noItalic = !italicCb.checked;
    applySettings(settings);
    saveSettings();
  });
  setRow("Italic comments", italicCb);

  const ligaCb = document.createElement("input");
  ligaCb.type = "checkbox";
  ligaCb.checked = !settings.noLigatures;
  ligaCb.addEventListener("change", () => {
    settings.noLigatures = !ligaCb.checked;
    applySettings(settings);
    saveSettings();
  });
  setRow("Ligatures", ligaCb);

  const sep = document.createElement("div");
  sep.className = "pt-dd-sep";
  gear.menu.appendChild(sep);

  let showingRaw = false;
  const rawItem = menuItem(gear.menu, "Raw view", () => {
    showingRaw = !showingRaw;
    rawItem.classList.toggle("pt-active", showingRaw);
    rawPre.style.display = showingRaw ? "" : "none";
    main.style.display = showingRaw ? "none" : "";
    tree.style.display = showingRaw ? "none" : "";
    splitter.style.display = showingRaw ? "none" : "";
    gear.dd.open = false;
  });
  menuItem(gear.menu, "Clear viewed", () => {
    gear.dd.open = false;
    for (const cb of document.querySelectorAll(".pt-viewed:not(.pt-fullfile) input:checked")) {
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
    }
    window.ptUpdateProgress?.();
  });
  const openTokensDialog = async () => {
    document.getElementById("pt-tokens-dialog")?.remove();
    let { gitlabs } = await chrome.storage.local.get("gitlabs");
    if (!gitlabs) ({ gitlabs = {} } = await chrome.storage.sync.get("gitlabs"));

    const overlay = document.createElement("div");
    overlay.id = "pt-themes-dialog";
    const panel = document.createElement("div");
    panel.className = "pt-dialog pt-tokens";
    panel.innerHTML =
      `<div class="pt-gallery-head"><h3>Access tokens</h3></div>` +
      `<p>Tokens enable review actions; they are stored locally and never leave the browser except to their own host. Changes apply after reloading the diff page.</p>`;

    const glSection = document.createElement("div");
    glSection.innerHTML =
      `<h4>GitLab instances</h4><p>Personal access token with the <code>api</code> scope.</p>`;
    const rows = document.createElement("table");
    rows.className = "pt-tokens-table";
    glSection.appendChild(rows);

    const ghInput = document.createElement("input");
    ghInput.type = "password";
    ghInput.placeholder = "ghp_… or github_pat_…";
    ghInput.value = gitlabs["github.com"]?.token || "";

    const save = () => {
      const m = {};
      for (const tr of rows.querySelectorAll("tr")) {
        const [h, t] = tr.querySelectorAll("input");
        const host = h.value.trim();
        if (host && host !== "github.com") m[host] = { token: t.value.trim() };
      }
      if (ghInput.value.trim()) m["github.com"] = { token: ghInput.value.trim() };
      chrome.storage.local.set({ gitlabs: m });
    };

    const addRow = (host = "", tok = "") => {
      const tr = rows.insertRow();
      const c1 = tr.insertCell();
      const c2 = tr.insertCell();
      const c3 = tr.insertCell();
      const hi = document.createElement("input");
      hi.placeholder = "gitlab.example.com";
      hi.value = host;
      const ti = document.createElement("input");
      ti.type = "password";
      ti.placeholder = "glpat-…";
      ti.value = tok;
      const rm = document.createElement("button");
      rm.textContent = "✕";
      rm.addEventListener("click", () => {
        tr.remove();
        save();
      });
      c1.appendChild(hi);
      c2.appendChild(ti);
      c3.appendChild(rm);
      hi.addEventListener("change", save);
      ti.addEventListener("change", save);
    };
    for (const [host, v] of Object.entries(gitlabs))
      if (host !== "github.com") addRow(host, v.token || "");
    if (!rows.rows.length) addRow();

    const addBtn = document.createElement("button");
    addBtn.textContent = "Add instance";
    addBtn.className = "pt-token-add";
    addBtn.addEventListener("click", () => addRow());
    glSection.appendChild(addBtn);
    panel.appendChild(glSection);

    const ghSection = document.createElement("div");
    ghSection.innerHTML =
      `<h4>GitHub</h4><p>Classic token (<code>repo</code> scope) or a fine-grained token with Pull requests read &amp; write. Used on github.com and patch-diff.githubusercontent.com.</p>`;
    ghInput.addEventListener("change", save);
    ghSection.appendChild(ghInput);
    panel.appendChild(ghSection);

    const actions = document.createElement("div");
    actions.className = "pt-form-actions";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Done";
    closeBtn.className = "pt-primary";
    closeBtn.addEventListener("click", () => {
      save();
      overlay.remove();
    });
    actions.appendChild(closeBtn);
    panel.appendChild(actions);

    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        save();
        overlay.remove();
      }
    });
    document.body.appendChild(overlay);
  };

  menuItem(gear.menu, "Access tokens…", () => {
    gear.dd.open = false;
    openTokensDialog();
  });

  const sep2 = document.createElement("div");
  sep2.className = "pt-dd-sep";
  gear.menu.appendChild(sep2);
  const star = octicon(
    "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z",
    13
  );
  menuItem(gear.menu, `${star}<span>Enjoying it? Star patchtree on GitHub</span>`, () => {
    gear.dd.open = false;
    window.open("https://github.com/danilrwx/patchtree", "_blank", "noopener");
  }).classList.add("pt-star-item");

  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll("details.pt-dd[open], details#pt-review[open]"))
      if (!d.contains(e.target)) d.open = false;
  });

  const oldBody = document.body;
  oldBody.textContent = "";
  oldBody.appendChild(rawPre);
  oldBody.appendChild(root);
  document.documentElement.classList.add("pt-on");

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    const sections = views.map((v) => v.section).filter((s) => s.offsetParent);
    const threads = [...document.querySelectorAll(".pt-comments-row")].filter((r) => r.offsetParent);
    const top = (el) => el.getBoundingClientRect().top;
    const currentIdx = (els, limit = 61) => {
      let idx = -1;
      for (let i = 0; i < els.length; i++) if (top(els[i]) <= limit) idx = i;
      return idx;
    };
    const go = (el) => el && window.scrollTo({ top: window.scrollY + top(el) - 56 });
    const goCenter = (el) => {
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("pt-flash");
      setTimeout(() => el.classList.remove("pt-flash"), 1200);
    };
    const mid = window.innerHeight / 2;
    const cur = () => sections[Math.max(0, currentIdx(sections))];
    switch (e.key) {
      case "j":
        go(sections[Math.min(sections.length - 1, currentIdx(sections) + 1)]);
        break;
      case "k":
        go(sections[Math.max(0, currentIdx(sections) - 1)]);
        break;
      case "n":
        goCenter(threads[Math.min(threads.length - 1, currentIdx(threads, mid) + 1)]);
        break;
      case "p":
        goCenter(threads[Math.max(0, currentIdx(threads, mid) - 1)]);
        break;
      case "v":
        cur()?.querySelector(".pt-viewed:not(.pt-fullfile) input")?.click();
        break;
      case "x":
        cur()?.classList.toggle("pt-folded");
        break;
      case "/":
        e.preventDefault();
        filter.focus();
        break;
    }
  });

  renderDiff(raw);

  window.ptView = {
    bar,
    root,
    renderDiff,
    initialRaw: raw,
    makeDropdown,
    menuItem,
    esc,
    addSettingRow: (labelText, control) => {
      const row = buildRow(labelText, control);
      const sep = gear.menu.querySelector(".pt-dd-sep");
      if (sep) gear.menu.insertBefore(row, sep);
      else gear.menu.appendChild(row);
    },
    addMenuItem: (html, fn) => menuItem(gear.menu, html, fn),
    markCommented: (counts) => {
      for (const v of views) {
        const el = v.treeLink?.querySelector(".pt-tree-cmt");
        if (!el) continue;
        const n = counts.get(v.path) || 0;
        el.innerHTML = n ? `${window.ptIcons.comment}${n}` : "";
      }
    },
  };
  window.dispatchEvent(new CustomEvent("pt-rendered"));
}

main();