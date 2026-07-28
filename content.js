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

let viewedSet = new Set();
let saveViewed = () => {};

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

function setCtxMeta(tr, meta, o, n) {
  tr.dataset.path = meta.path;
  tr.dataset.oldPath = meta.oldPath;
  tr.dataset.old = o;
  tr.dataset.new = n;
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
    `<span class="pt-fold">▾</span>` +
    `<span class="pt-path">${esc(path)}</span>` +
    (file.oldPath && file.newPath && file.oldPath !== file.newPath
      ? `<span class="pt-rename">← ${esc(file.oldPath)}</span>`
      : "") +
    `<span class="pt-stats"><span class="pt-adds">+${adds}</span> <span class="pt-dels">−${dels}</span></span>`;
  section.appendChild(header);

  const view = { section, path, adds, dels, cells: null, texts: null, lang: langFor(path) };

  const foldIcon = header.querySelector(".pt-fold");
  const setFolded = (f) => {
    section.classList.toggle("pt-folded", f);
    foldIcon.textContent = f ? "▸" : "▾";
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
  });

  header.addEventListener("click", (e) => {
    if (e.target.closest(".pt-viewed") || e.target.closest(".pt-fullfile")) return;
    setFolded(!section.classList.contains("pt-folded"));
  });
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

  view.meta = { path, oldPath: file.oldPath || "" };
  view.expanders = [];
  const canExpand = !full && !file.binary;
  const addExpander = (oldFrom, newFrom, newTo) => {
    const make = (table) => {
      const tr = table.insertRow();
      tr.className = "pt-expander";
      const td = tr.insertCell();
      td.colSpan = 4;
      td.textContent = "⋯ expand hidden lines";
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

  if (canExpand) addExpander(nextOld, nextNew, Infinity);

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
        `<span class="pt-tree-stats"><span class="pt-adds">+${v.adds}</span> <span class="pt-dels">−${v.dels}</span></span>`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
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
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2.5" width="14" height="4.7" rx="1.2"/><rect x="1" y="8.8" width="14" height="4.7" rx="1.2"/></svg>';
const SVG_COLS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="6.3" height="12" rx="1.2"/><rect x="8.7" y="2" width="6.3" height="12" rx="1.2"/></svg>';
const SVG_GEAR =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"/></svg>';

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
  st.setProperty("--pt-size", (s.fontSize || 12) + "px");
  st.setProperty("--pt-ui-size", (s.uiFontSize || 13) + "px");
  st.setProperty("--pt-comment-style", s.noItalic ? "normal" : "italic");

  const palette = BASE16[s.theme];
  const vars = palette ? THEME_VARS(palette.split(" ")) : null;
  for (const k of Object.keys(THEME_VARS(BASE16["Default Dark"].split(" ")))) {
    if (vars) st.setProperty(`--pt-${k}`, vars[k]);
    else st.removeProperty(`--pt-${k}`);
  }
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
  filter.addEventListener("input", () => applyTreeFilter(treeList, filter.value));

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
    const move = (ev) => {
      const w = Math.max(160, Math.min(800, ev.clientX - left));
      tree.style.width = w + "px";
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
    applyTreeFilter(treeList, filter.value);
    for (const v of views) main.appendChild(v.section);

    for (const v of views) {
      if (!v.cells || !v.lang) continue;
      highlightSide(v.lang, v.texts.new, v.cells.new);
      highlightSide(v.lang, v.texts.old, v.cells.old);
    }
  }

  const { view: savedView = "unified" } = await chrome.storage.sync.get("view");

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

  const setRow = (labelText, control) => {
    const row = document.createElement("label");
    row.className = "pt-set-row";
    const span = document.createElement("span");
    span.textContent = labelText;
    row.append(span, control);
    gear.menu.appendChild(row);
  };

  const themeSel = document.createElement("select");
  for (const name of ["GitHub", ...Object.keys(BASE16)])
    themeSel.append(new Option(name, name));
  themeSel.value = BASE16[settings.theme] ? settings.theme : "GitHub";
  themeSel.addEventListener("change", () => {
    settings.theme = themeSel.value === "GitHub" ? "" : themeSel.value;
    applySettings(settings);
    saveSettings();
  });
  setRow("Theme", themeSel);

  // bundled faces report unloaded until first use, so fonts.check() is false for them
  const BUNDLED_FONTS = new Set([
    "JetBrains Mono",
    "Inter",
    "JetBrainsMono Nerd Font Mono",
    "FiraCode Nerd Font Mono",
    "Hack Nerd Font Mono",
    "MesloLGS Nerd Font Mono",
  ]);
  const fontSelect = (key, candidates) => {
    const sel = document.createElement("select");
    sel.append(new Option("Default", ""));
    const avail = candidates.filter(
      (f) => BUNDLED_FONTS.has(f) || document.fonts.check(`12px "${f}"`)
    );
    if (settings[key] && !avail.includes(settings[key])) avail.unshift(settings[key]);
    for (const f of avail) sel.append(new Option(f, f));
    sel.value = settings[key] || "";
    sel.addEventListener("change", () => {
      settings[key] = sel.value;
      applySettings(settings);
      saveSettings();
    });
    return sel;
  };
  setRow(
    "UI font",
    fontSelect("uiFont", [
      "Inter", "SF Pro Text", "Helvetica Neue", "Segoe UI", "Roboto", "IBM Plex Sans",
      "Noto Sans", "Open Sans", "Lato", "Manrope", "Geist", "Ubuntu", "PT Sans",
    ])
  );
  setRow(
    "Code font",
    fontSelect("codeFont", [
      "JetBrains Mono", "JetBrainsMono Nerd Font Mono", "FiraCode Nerd Font Mono",
      "Hack Nerd Font Mono", "MesloLGS Nerd Font Mono", "SF Mono", "Menlo", "Monaco",
      "Consolas", "Fira Code", "Cascadia Code", "Hack", "IBM Plex Mono",
      "Source Code Pro", "Iosevka", "Iosevka NFM", "Berkeley Mono", "Victor Mono",
      "Geist Mono", "Commit Mono", "MesloLGS NF", "Ubuntu Mono", "PT Mono",
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
  sizeRow("Code font size", "fontSize", 12);
  sizeRow("UI font size", "uiFontSize", 13);

  const italicCb = document.createElement("input");
  italicCb.type = "checkbox";
  italicCb.checked = !settings.noItalic;
  italicCb.addEventListener("change", () => {
    settings.noItalic = !italicCb.checked;
    applySettings(settings);
    saveSettings();
  });
  setRow("Italic comments", italicCb);

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
    for (const cb of document.querySelectorAll(".pt-viewed input:checked")) {
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
    }
  });
  menuItem(gear.menu, "GitLab tokens…", () => {
    gear.dd.open = false;
    chrome.runtime.sendMessage({ type: "openOptions" });
  });

  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll("details.pt-dd[open], details#pt-review[open]"))
      if (!d.contains(e.target)) d.open = false;
  });

  const oldBody = document.body;
  oldBody.textContent = "";
  oldBody.appendChild(rawPre);
  oldBody.appendChild(root);
  document.documentElement.classList.add("pt-on");

  renderDiff(raw);

  window.ptView = { bar, root, renderDiff, initialRaw: raw, makeDropdown, menuItem, esc };
  window.dispatchEvent(new CustomEvent("pt-rendered"));
}

main();
