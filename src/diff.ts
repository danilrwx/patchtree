// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// Pure diff logic: parsing a unified diff, pairing hunk lines for the split
// view, intra-line word diff, language resolution and line HTML rendering.
// No DOM — safe to import from the worker, the components and the tests.

export type LineKind = "+" | "-" | " " | "\\";

export interface Line {
  t: LineKind;
  s: string;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  context: string;
  lines: Line[];
}

export interface DiffFile {
  header: string[];
  oldPath: string | null;
  newPath: string | null;
  hunks: Hunk[];
  binary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

export interface ParsedDiff {
  preamble: string;
  files: DiffFile[];
}

export interface AlignSide {
  no: number;
  text: string;
  other?: number;
}

export interface AlignPair {
  old: AlignSide | null;
  new: AlignSide | null;
  ctx?: boolean;
}

// a highlight/word span: [s, e) tagged with a css-suffix class
export interface Range {
  s: number;
  e: number;
  c: string;
}

export interface WordDiff {
  a: Range[];
  b: Range[];
}

const LANG_BY_EXT: Record<string, string> = {
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

export function langFor(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split("/").pop()!;
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANG_BY_EXT[ext] || null;
}

// Helm/Go templates: .tpl is always a template; a .yaml/.yml carrying
// {{ … }} actions is highlighted as a template too (yaml text stays plain,
// the actions get colored), everything else keeps its yaml highlighting.
export function resolveLang(path: string | null | undefined, text: string | null | undefined): string | null {
  const p = path || "";
  const name = p.split("/").pop()!.toLowerCase();
  if (/\.tpl$/i.test(p) || name === "werf.yaml" || /\.?werf\.inc\.yaml$/.test(name)) return "gotmpl";
  const base = langFor(path);
  if (base === "yaml" && /\{\{.*?\}\}/s.test(text || "")) return "gotmpl";
  return base;
}

export function parseDiff(text: string): ParsedDiff {
  const lines = text.split("\n");
  const files: DiffFile[] = [];
  const preamble: string[] = [];
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;

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
export function alignHunk(h: Hunk): AlignPair[] {
  const pairs: AlignPair[] = [];
  let dels: AlignSide[] = [];
  let adds: AlignSide[] = [];
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

// data-* attributes review.js reads off each row to anchor comments
export interface RowMeta {
  path: string;
  oldPath: string;
  old?: number;
  new?: number;
  ctx: boolean;
  codeOld: string | number;
  codeNew: string | number;
}

export interface PairModel {
  ctx: boolean;
  old: AlignSide | null;
  new: AlignSide | null;
  // index into the side's reconstructed text, for highlight lookup
  oldRow: number | null;
  newRow: number | null;
  // word-diff background ranges for the changed tokens
  wdA: Range[] | null;
  wdB: Range[] | null;
}

export interface Gap {
  id: string;
  oldFrom: number;
  newFrom: number;
  newTo: number;
}

export interface Segment {
  gap: Gap | null;
  header: { oldStart: number; newStart: number; context: string };
  pairs: PairModel[];
}

export interface FileModel {
  path: string;
  oldPath: string;
  segments: Segment[];
  trailingGap: Gap | null;
  oldText: string;
  newText: string;
  full: boolean;
}

export function rowMeta(m: FileModel, o: AlignSide | null, n: AlignSide | null, ctx: boolean): RowMeta {
  return {
    path: m.path,
    oldPath: m.oldPath,
    old: o ? o.no : undefined,
    new: n ? n.no : undefined,
    ctx,
    codeOld: o ? o.no : (n?.other ?? ""),
    codeNew: n ? n.no : (o?.other ?? ""),
  };
}

// Build the render model for one file: hunk segments with per-line row indices
// and word-diff ranges, inter-hunk gaps (for expanders) and the reconstructed
// old/new side texts. Pure — the component renders it, the tests assert it.
export function buildFileModel(file: DiffFile): FileModel {
  const path = file.newPath || file.oldPath || "(unknown)";
  const full = !!(file.isNew || file.isDeleted);
  const segments: Segment[] = [];
  const oldParts: string[] = [];
  const newParts: string[] = [];
  let oldRow = 0;
  let newRow = 0;
  let nextOld = 1;
  let nextNew = 1;

  file.hunks.forEach((h, hi) => {
    const gap =
      !full && h.newStart > nextNew
        ? { id: `${path}#${hi}`, oldFrom: nextOld, newFrom: nextNew, newTo: h.newStart - 1 }
        : null;
    let cntOld = 0;
    let cntNew = 0;
    for (const l of h.lines) {
      if (l.t !== "+" && l.t !== "\\") cntOld++;
      if (l.t !== "-" && l.t !== "\\") cntNew++;
    }
    nextOld = h.oldStart + cntOld;
    nextNew = h.newStart + cntNew;

    const pairs: PairModel[] = [];
    for (const pair of alignHunk(h)) {
      const p: PairModel = {
        ctx: !!pair.ctx,
        old: pair.old,
        new: pair.new,
        oldRow: null,
        newRow: null,
        wdA: null,
        wdB: null,
      };
      if (pair.ctx) {
        p.oldRow = oldRow++;
        p.newRow = newRow++;
        oldParts.push(pair.old!.text);
        newParts.push(pair.new!.text);
      } else {
        const wd = pair.old && pair.new ? wordDiff(pair.old.text, pair.new.text) : null;
        if (pair.old) {
          p.oldRow = oldRow++;
          oldParts.push(pair.old.text);
          if (wd?.a.length) p.wdA = wd.a;
        }
        if (pair.new) {
          p.newRow = newRow++;
          newParts.push(pair.new.text);
          if (wd?.b.length) p.wdB = wd.b;
        }
      }
      pairs.push(p);
    }
    segments.push({
      gap,
      header: { oldStart: h.oldStart, newStart: h.newStart, context: h.context },
      pairs,
    });
  });

  const trailingGap =
    !full && file.hunks.length
      ? { id: `${path}#tail`, oldFrom: nextOld, newFrom: nextNew, newTo: Infinity }
      : null;

  return {
    path,
    oldPath: file.oldPath || "",
    segments,
    trailingGap,
    oldText: oldParts.join("\n"),
    newText: newParts.join("\n"),
    full,
  };
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderLineHTML(
  text: string,
  ranges: Range[] | null | undefined,
  bg: Range[] | null | undefined
): string {
  const colors: Range[] = [];
  if (ranges?.length) {
    // identical spans: keep the last capture (higher tree-sitter precedence),
    // e.g. a yaml key tagged both @string and @variable.other.member
    const bySpan = new Map<string, Range>();
    for (const r of ranges) bySpan.set(`${r.s}:${r.e}`, r);
    let pos = 0;
    for (const r of [...bySpan.values()].sort((a, b) => a.s - b.s || b.e - a.e)) {
      if (r.s < pos) continue;
      const s = Math.max(0, Math.min(r.s, text.length));
      const e = Math.max(s, Math.min(r.e, text.length));
      if (e > s) colors.push({ s, e, c: r.c });
      pos = e;
    }
  }
  if (!colors.length && !bg?.length) return esc(text);

  const cuts = new Set<number>([0, text.length]);
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
    const cls: string[] = [];
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
export function wordDiff(a: string, b: string): WordDiff | null {
  const tokenize = (s: string) => {
    const out: { t: string; s: number }[] = [];
    for (const m of s.matchAll(/\w+|\s+|[^\w\s]/g)) out.push({ t: m[0], s: m.index! });
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

  const ranges = (toks: { t: string; s: number }[], keep: boolean[], cls: string): Range[] => {
    const out: Range[] = [];
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
