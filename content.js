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
  if (base === "Dockerfile") return null;
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
      else if (line.startsWith("Binary files") || line === "GIT binary patch") file.binary = true;
      file.header.push(line);
      continue;
    }
    if (line.startsWith("+")) hunk.lines.push({ t: "+", s: line.slice(1) });
    else if (line.startsWith("-")) hunk.lines.push({ t: "-", s: line.slice(1) });
    else if (line.startsWith(" ") || line === "") hunk.lines.push({ t: " ", s: line.slice(1) });
    else if (line.startsWith("\\")) hunk.lines.push({ t: "\\", s: line });
    else {
      // trailer between hunks (e.g. next file header line handled above)
      hunk = null;
      file.header.push(line);
    }
  }
  return { preamble: preamble.join("\n").trim(), files };
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

function buildFileView(file) {
  const section = document.createElement("section");
  section.className = "pt-file";

  const path = file.newPath || file.oldPath || "(unknown)";
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

  if (file.binary) {
    const p = document.createElement("div");
    p.className = "pt-binary";
    p.textContent = "binary file";
    section.appendChild(p);
    return { section, cells: null };
  }

  const table = document.createElement("table");
  table.className = "pt-table";

  // cells[side][row] -> {td, text}; side rows are 0-based indexes into the
  // reconstructed old/new texts used for tree-sitter parsing
  const cells = { old: [], new: [] };
  const oldParts = [];
  const newParts = [];

  for (const h of file.hunks) {
    const hr = table.insertRow();
    hr.className = "pt-hunk";
    const td = hr.insertCell();
    td.colSpan = 4;
    td.textContent = `@@ -${h.oldStart} +${h.newStart} @@${h.context}`;

    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const l of h.lines) {
      if (l.t === "\\") continue;
      const tr = table.insertRow();
      tr.className = l.t === "+" ? "pt-add" : l.t === "-" ? "pt-del" : "pt-ctx";
      const tdOld = tr.insertCell();
      tdOld.className = "pt-no";
      const tdNew = tr.insertCell();
      tdNew.className = "pt-no";
      const tdMark = tr.insertCell();
      tdMark.className = "pt-mark";
      tdMark.textContent = l.t === " " ? "" : l.t;
      const tdCode = tr.insertCell();
      tdCode.className = "pt-code";
      tdCode.textContent = l.s;

      if (l.t !== "+") {
        tdOld.textContent = oldNo++;
        cells.old.push({ td: l.t === "-" ? tdCode : null, text: l.s });
        oldParts.push(l.s);
      }
      if (l.t !== "-") {
        tdNew.textContent = newNo++;
        cells.new.push({ td: tdCode, text: l.s });
        newParts.push(l.s);
      }
    }
  }

  section.appendChild(table);
  return {
    section,
    cells,
    texts: { old: oldParts.join("\n"), new: newParts.join("\n") },
    lang: langFor(path),
  };
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
    if (!cell || !cell.td) continue;
    cell.td.innerHTML = renderLineHTML(cell.text, ranges);
  }
}

function looksLikeDiff(text) {
  return /^(diff --git |From [0-9a-f]{40} |--- )/m.test(text.slice(0, 4096));
}

async function main() {
  if (document.contentType !== "text/plain") return;
  const raw = document.body.innerText;
  if (!looksLikeDiff(raw)) return;

  const parsed = parseDiff(raw);
  if (parsed.files.length === 0) return;

  const root = document.createElement("div");
  root.id = "pt-root";

  const bar = document.createElement("div");
  bar.id = "pt-bar";
  const btn = document.createElement("button");
  btn.textContent = "raw";
  bar.appendChild(btn);
  root.appendChild(bar);

  if (parsed.preamble) {
    const pre = document.createElement("pre");
    pre.id = "pt-preamble";
    pre.textContent = parsed.preamble;
    root.appendChild(pre);
  }

  const views = parsed.files.map(buildFileView);
  for (const v of views) root.appendChild(v.section);

  const oldBody = document.body;
  const rawPre = document.createElement("pre");
  rawPre.id = "pt-raw";
  rawPre.style.display = "none";
  rawPre.textContent = raw;
  oldBody.textContent = "";
  oldBody.appendChild(rawPre);
  oldBody.appendChild(root);
  document.documentElement.classList.add("pt-on");

  let showingRaw = false;
  btn.addEventListener("click", () => {
    showingRaw = !showingRaw;
    rawPre.style.display = showingRaw ? "" : "none";
    for (const v of views) v.section.style.display = showingRaw ? "none" : "";
    document.getElementById("pt-preamble")?.style.setProperty("display", showingRaw ? "none" : "");
    btn.textContent = showingRaw ? "pretty" : "raw";
  });

  for (const v of views) {
    if (!v.cells || !v.lang) continue;
    highlightSide(v.lang, v.texts.new, v.cells.new);
    highlightSide(v.lang, v.texts.old, v.cells.old);
  }
}

main();
