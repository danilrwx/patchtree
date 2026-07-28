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
};

// Highlighting is skipped for sides bigger than this to keep the page responsive.
const MAX_HIGHLIGHT_CHARS = 300 * 1024;

function langFor(path) {
  if (!path) return null;
  const base = path.split("/").pop();
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  return LANG_BY_EXT[ext] || null;
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
    if (l.t === "-") dels.push({ no: oldNo++, text: l.s });
    else if (l.t === "+") adds.push({ no: newNo++, text: l.s });
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

function renderLineHTML(text, ranges) {
  if (!ranges || ranges.length === 0) return esc(text);
  const sorted = ranges.slice().sort((a, b) => a.s - b.s || b.e - a.e);
  let out = "";
  let pos = 0;
  for (const r of sorted) {
    if (r.s < pos) continue;
    const s = Math.max(0, Math.min(r.s, text.length));
    const e = Math.max(s, Math.min(r.e, text.length));
    if (s > pos) out += esc(text.slice(pos, s));
    out += `<span class="pt-${r.c}">` + esc(text.slice(s, e)) + "</span>";
    pos = e;
  }
  if (pos < text.length) out += esc(text.slice(pos));
  return out;
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

function hunkRow(table, span, h) {
  const tr = table.insertRow();
  tr.className = "pt-hunk";
  const td = tr.insertCell();
  td.colSpan = span;
  td.textContent = `@@ -${h.oldStart} +${h.newStart} @@${h.context}`;
}

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
  header.innerHTML =
    `<span class="pt-path">${esc(path)}</span>` +
    (file.oldPath && file.newPath && file.oldPath !== file.newPath
      ? `<span class="pt-rename">← ${esc(file.oldPath)}</span>`
      : "") +
    `<span class="pt-stats"><span class="pt-adds">+${adds}</span> <span class="pt-dels">−${dels}</span></span>`;
  section.appendChild(header);

  const view = { section, path, adds, dels, cells: null, texts: null, lang: langFor(path) };
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

  const rowMeta = (tr, o, n) => {
    tr.dataset.path = file.newPath || file.oldPath || "";
    tr.dataset.oldPath = file.oldPath || "";
    if (o) tr.dataset.old = o.no;
    if (n) tr.dataset.new = n.no;
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
    rowMeta(tr, o, n);
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

  for (const h of file.hunks) {
    hunkRow(unified, 4, h);
    if (split) hunkRow(split, 4, h);
    for (const pair of alignHunk(h)) {
      let oldTd = null;
      let newTd = null;
      if (split) {
        const str = split.insertRow();
        str.className = "pt-srow";
        rowMeta(str, pair.old, pair.new);
        oldTd = splitCell(str, pair.old, pair.ctx ? "pt-ctx" : "pt-del");
        newTd = splitCell(str, pair.new, pair.ctx ? "pt-ctx" : "pt-add");
      }

      if (pair.ctx) {
        const utd = unifiedLine("pt-ctx", pair.old, pair.new, pair.new.text);
        const row = regNew(pair.new.text, utd);
        if (newTd) cells.new[row].tds.push(newTd);
        regOld(pair.old.text, oldTd);
      } else {
        if (pair.old) {
          const utd = unifiedLine("pt-del", pair.old, null, pair.old.text);
          const row = regOld(pair.old.text, utd);
          if (oldTd) cells.old[row].tds.push(oldTd);
        }
        if (pair.new) {
          const utd = unifiedLine("pt-add", null, pair.new, pair.new.text);
          const row = regNew(pair.new.text, utd);
          if (newTd) cells.new[row].tds.push(newTd);
        }
      }
    }
  }

  section.appendChild(unified);
  if (split) section.appendChild(split);
  view.cells = cells;
  view.texts = { old: oldParts.join("\n"), new: newParts.join("\n") };
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
    for (const td of cell.tds) td.innerHTML = renderLineHTML(cell.text, ranges);
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
    for (const [name, child] of [...node.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
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
        `<span class="pt-tree-stats"><span class="pt-adds">+${v.adds}</span> <span class="pt-dels">−${v.dels}</span></span>`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        v.section.scrollIntoView();
      });
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

function applyTreeFilter(list, query) {
  const q = query.trim().toLowerCase();
  for (const a of list.querySelectorAll(".pt-tree-file"))
    a.style.display = !q || a.dataset.path.includes(q) ? "" : "none";
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
  filter.addEventListener("input", () => applyTreeFilter(treeList, filter.value));

  const main = document.createElement("div");
  main.id = "pt-main";
  root.appendChild(main);

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
    applyTreeFilter(treeList, filter.value);
    for (const v of views) main.appendChild(v.section);

    for (const v of views) {
      if (!v.cells || !v.lang) continue;
      highlightSide(v.lang, v.texts.new, v.cells.new);
      highlightSide(v.lang, v.texts.old, v.cells.old);
    }
  }

  const { view: savedView = "unified" } = await chrome.storage.sync.get("view");
  root.classList.add(savedView === "split" ? "pt-mode-split" : "pt-mode-unified");

  const viewBtn = document.createElement("button");
  viewBtn.textContent = savedView === "split" ? "Inline" : "Side-by-side";
  viewBtn.addEventListener("click", () => {
    const toSplit = root.classList.contains("pt-mode-unified");
    root.classList.toggle("pt-mode-split", toSplit);
    root.classList.toggle("pt-mode-unified", !toSplit);
    viewBtn.textContent = toSplit ? "Inline" : "Side-by-side";
    chrome.storage.sync.set({ view: toSplit ? "split" : "unified" });
  });
  bar.appendChild(viewBtn);

  const rawBtn = document.createElement("button");
  rawBtn.textContent = "Raw";
  bar.appendChild(rawBtn);

  const optBtn = document.createElement("button");
  optBtn.textContent = "⚙";
  optBtn.title = "Extension options";
  optBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));
  bar.appendChild(optBtn);

  const oldBody = document.body;
  oldBody.textContent = "";
  oldBody.appendChild(rawPre);
  oldBody.appendChild(root);
  document.documentElement.classList.add("pt-on");

  let showingRaw = false;
  rawBtn.addEventListener("click", () => {
    showingRaw = !showingRaw;
    rawPre.style.display = showingRaw ? "" : "none";
    main.style.display = showingRaw ? "none" : "";
    tree.style.display = showingRaw ? "none" : "";
    rawBtn.textContent = showingRaw ? "Pretty" : "Raw";
  });

  renderDiff(raw);

  window.ptView = { bar, root, renderDiff, initialRaw: raw };
  window.dispatchEvent(new CustomEvent("pt-rendered"));
}

main();
