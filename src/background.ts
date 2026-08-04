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

// the vendored loader is fetched at build time and resolved at runtime
// relative to dist/background.js (kept external when esbuild bundles the
// worker), not by tsc
// @ts-expect-error — no types for the vendored web-tree-sitter loader
import { Parser, Language, Query } from "./assets/vendor/web-tree-sitter.js";
import { hljsRows } from "./hljs";

// typescript files are parsed with the tsx grammar so one wasm covers ts/tsx,
// and its query is the javascript query plus typescript additions
const GRAMMAR: Record<string, string> = { typescript: "tsx" };
const QUERY_PARTS: Record<string, string[]> = {
  typescript: ["javascript", "typescript"],
  cpp: ["c", "cpp"],
};

const MAX_CAPTURES = 50000;

interface Lang {
  language: any;
  query: any;
}
type Row = { s: number; e: number; c: string };
type Rows = Record<number, Row[]>;

let ready: any;
let parser: any;
const langs = new Map<string, Promise<Lang>>();

function init() {
  if (!ready) {
    ready = Parser.init({
      locateFile: () => chrome.runtime.getURL("assets/vendor/web-tree-sitter.wasm"),
    }).then(() => {
      parser = new Parser();
    });
  }
  return ready;
}

async function loadLang(name: string): Promise<Lang> {
  if (langs.has(name)) return langs.get(name)!;
  const p = (async () => {
    const grammar = GRAMMAR[name] || name;
    const language = await Language.load(
      chrome.runtime.getURL(`assets/vendor/wasm/tree-sitter-${grammar}.wasm`)
    );
    const parts = QUERY_PARTS[name] || [name];
    const sources = await Promise.all(
      parts.map((q) =>
        fetch(chrome.runtime.getURL(`assets/queries/${q}.scm`)).then((r) => r.text())
      )
    );
    const query = new Query(language, sources.join("\n"));
    return { language, query };
  })();
  langs.set(name, p);
  p.catch(() => langs.delete(name));
  return p;
}

// markdown's queries come from nvim-treesitter, whose "text.*" family carries
// the meaning: text.strong is bold, text.title a heading. Collapsing them to a
// bare "text" would paint prose in one flat colour.
const CAPTURE_ALIAS: Record<string, string> = {
  "text.title": "keyword",
  "text.strong": "strong",
  "text.emphasis": "em",
  "text.literal": "string",
  "text.uri": "property",
  "text.reference": "constant",
  "text.quote": "comment",
  "string.escape": "escape",
};

function cssClass(captureName: string): string {
  // mapping keys / struct fields get their own color, not the generic variable
  if (captureName.startsWith("variable.other.member")) return "property";
  const two = captureName.split(".").slice(0, 2).join(".");
  return CAPTURE_ALIAS[captureName] || CAPTURE_ALIAS[two] || captureName.split(".")[0];
}

function lineStartsOf(text: string): number[] {
  const ls = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") ls.push(i + 1);
  return ls;
}

// split a node across the lines it spans into per-line {s,e,c} entries
function pushNode(rows: Rows, node: any, c: string, lineStarts: number[], text: string) {
  for (let row = node.startPosition.row; row <= node.endPosition.row; row++) {
    const lineStart = lineStarts[row];
    const lineEnd = row + 1 < lineStarts.length ? lineStarts[row + 1] - 1 : text.length;
    const s = Math.max(node.startIndex, lineStart) - lineStart;
    const e = Math.min(node.endIndex, lineEnd) - lineStart;
    if (e > s) (rows[row] ||= []).push({ s, e, c });
  }
}

function parseWith(language: any, text: string) {
  parser.setLanguage(language);
  return parser.parse(text);
}

function highlight(langName: string, text: string) {
  if (langName.startsWith("hljs:"))
    return Promise.resolve({ rows: hljsRows(langName.slice(5), text) });
  if (langName === "gotmpl") return highlightGotmpl(text);
  if (langName === "markdown") return highlightMarkdown(text);
  return init()
    .then(() => loadLang(langName))
    .then(({ language, query }: Lang) => {
      const tree = parseWith(language, text);
      if (!tree) return { rows: {} };
      const lineStarts = lineStartsOf(text);
      const rows: Rows = {};
      for (const { name, node } of query.captures(tree.rootNode).slice(0, MAX_CAPTURES))
        pushNode(rows, node, cssClass(name), lineStarts, text);
      tree.delete();
      return { rows };
    });
}

// Helm/Go templates: highlight as yaml with the {{ … }} actions on top
// (like nvim-treesitter's gotmpl setup). The yaml grammar chokes on inline
// template syntax, so it parses a copy with every action blanked out — same
// length and line breaks, so capture positions still map to the original —
// then gotmpl actions are layered over it.
function highlightGotmpl(text: string) {
  return init()
    .then(() => Promise.all([loadLang("gotmpl"), loadLang("yaml")]))
    .then(([gt, yaml]: Lang[]) => {
      const lineStarts = lineStartsOf(text);
      const rows: Rows = {};

      const masked = text.replace(/\{\{[\s\S]*?\}\}/g, (m) => m.replace(/[^\n]/g, " "));
      const yamlTree = parseWith(yaml.language, masked);
      for (const { name, node } of yaml.query.captures(yamlTree.rootNode).slice(0, MAX_CAPTURES))
        pushNode(rows, node, cssClass(name), lineStarts, text);
      yamlTree.delete();

      const gtTree = parseWith(gt.language, text);
      for (const { name, node } of gt.query.captures(gtTree.rootNode).slice(0, MAX_CAPTURES))
        pushNode(rows, node, cssClass(name), lineStarts, text);
      gtTree.delete();

      return { rows };
    });
}

// Markdown is three passes over one text, mirroring the grammar's own
// injections.scm: the block structure, the inline grammar it injects into every
// paragraph, and — the point of the exercise — each fenced block re-parsed with
// the grammar its info string names, so ```go really is highlighted as Go.
const FENCE_LANG: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rs: "rust",
  golang: "go",
  yml: "yaml",
  "c++": "cpp",
  cs: "c_sharp",
  csharp: "c_sharp",
  kt: "kotlin",
  tf: "hcl",
  terraform: "hcl",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  gotemplate: "gotmpl",
  helm: "gotmpl",
};

const KNOWN_FENCE_LANGS = new Set([
  "bash", "c", "cpp", "c_sharp", "css", "dart", "dockerfile", "elixir", "go",
  "gotmpl", "groovy", "haskell", "hcl", "html", "java", "javascript", "json",
  "kotlin", "lua", "php", "python", "ruby", "rust", "scala", "toml",
  "typescript", "yaml", "zig",
]);

function fenceLang(info: string): string | null {
  // an info string can carry attributes: ```go title="main.go"
  const first = info.trim().split(/[\s,{]/)[0].toLowerCase();
  const name = FENCE_LANG[first] || first;
  return KNOWN_FENCE_LANGS.has(name) ? name : null;
}

// merge a nested parse (own row numbering, own columns) into the outer rows
function mergeRows(rows: Rows, nested: Rows, rowOffset: number, colOffset: number) {
  for (const [row, ranges] of Object.entries(nested)) {
    const target = (rows[+row + rowOffset] ||= []);
    for (const r of ranges as Row[]) target.push({ s: r.s + colOffset, e: r.e + colOffset, c: r.c });
  }
}

function captureInto(rows: Rows, lang: Lang, text: string) {
  const tree = parseWith(lang.language, text);
  if (!tree) return;
  const lineStarts = lineStartsOf(text);
  for (const { name, node } of lang.query.captures(tree.rootNode).slice(0, MAX_CAPTURES))
    pushNode(rows, node, cssClass(name), lineStarts, text);
  tree.delete();
}

async function highlightMarkdown(text: string) {
  await init();
  const [md, mdInline] = await Promise.all([loadLang("markdown"), loadLang("markdown_inline")]);
  const rows: Rows = {};
  const lineStarts = lineStartsOf(text);

  const tree = parseWith(md.language, text);
  if (!tree) return { rows };
  // the block query paints whole fenced blocks (@text.literal) and marks their
  // content @none; both would win over the injected highlight, since
  // renderLineHTML keeps the outermost span of a line
  const SMOTHERS = new Set(["fenced_code_block", "code_fence_content"]);
  for (const { name, node } of md.query.captures(tree.rootNode).slice(0, MAX_CAPTURES)) {
    if (name === "none" || SMOTHERS.has(node.type)) continue;
    pushNode(rows, node, cssClass(name), lineStarts, text);
  }

  // walk the block tree for the two injection sites we care about
  const fences: { lang: string; row: number; col: number; text: string }[] = [];
  const inlines: { row: number; col: number; text: string }[] = [];
  const visit = (node: any) => {
    if (node.type === "inline") {
      inlines.push({
        row: node.startPosition.row,
        col: node.startPosition.column,
        text: node.text,
      });
      return;
    }
    if (node.type === "fenced_code_block") {
      const info = node.childForFieldName?.("info_string") ?? findChild(node, "info_string");
      const content = findChild(node, "code_fence_content");
      const lang = info && content ? fenceLang(info.text) : null;
      if (lang && content)
        fences.push({
          lang,
          row: content.startPosition.row,
          col: content.startPosition.column,
          text: content.text,
        });
      return;
    }
    for (let i = 0; i < node.childCount; i++) visit(node.child(i));
  };
  visit(tree.rootNode);
  tree.delete();

  for (const inl of inlines) {
    const nested: Rows = {};
    captureInto(nested, mdInline, inl.text);
    mergeRows(rows, nested, inl.row, inl.col);
  }

  for (const f of fences) {
    let nested: Rows;
    try {
      nested = (await highlight(f.lang, f.text)).rows;
    } catch {
      continue; // a missing grammar just leaves the block plain
    }
    // an indented fence (inside a list) shifts every column by the same amount
    mergeRows(rows, nested, f.row, f.col);
  }

  return { rows };
}

function findChild(node: any, type: string) {
  for (let i = 0; i < node.childCount; i++) if (node.child(i).type === type) return node.child(i);
  return null;
}

// The toolbar icon works both ways: from a merge/pull request it opens the
// diff, and from a diff it goes back to the request. Diff tabs remember which
// tab they came from, so going back returns to that tab instead of opening a
// third one. The map is intentionally in-memory: if the worker is recycled the
// fallback (open the URL) is still correct.
const diffOrigin = new Map<number, number>();

// a request page: .../-/merge_requests/N (GitLab) or .../pull/N (GitHub)
const requestUrl = (url: string) =>
  /^(https?:\/\/[^?#]*\/-\/merge_requests\/\d+)(?:[/?#].*)?$/.exec(url)?.[1] ||
  /^(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)(?:[/?#].*)?$/.exec(url)?.[1] ||
  null;

// the same request, reached from the raw diff we are looking at
const requestUrlFromDiff = (url: string) => {
  const m =
    /^(https?:\/\/[^?#]*\/-\/merge_requests\/\d+)\.(?:diff|patch)$/.exec(url) ||
    /^(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)\.(?:diff|patch)$/.exec(url);
  if (m) return m[1];
  const gh =
    /^https:\/\/patch-diff\.githubusercontent\.com\/raw\/([^/]+)\/([^/]+)\/pull\/(\d+)\.(?:diff|patch)$/.exec(
      url
    );
  return gh ? `https://github.com/${gh[1]}/${gh[2]}/pull/${gh[3]}` : null;
};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.url || tab.id == null) return;

  const back = requestUrlFromDiff(tab.url);
  if (back) {
    const from = diffOrigin.get(tab.id);
    if (from != null) {
      const alive = await chrome.tabs.get(from).catch(() => null);
      if (alive?.id != null && requestUrl(alive.url || "") === back) {
        await chrome.tabs.update(alive.id, { active: true });
        if (alive.windowId != null) await chrome.windows.update(alive.windowId, { focused: true });
        return;
      }
      diffOrigin.delete(tab.id);
    }
    chrome.tabs.update(tab.id, { url: back });
    return;
  }

  const base = requestUrl(tab.url);
  if (!base) return;
  const created = await chrome.tabs.create({ url: `${base}.diff`, index: tab.index + 1 });
  if (created.id != null) diffOrigin.set(created.id, tab.id);
});

chrome.tabs.onRemoved.addListener((id) => diffOrigin.delete(id));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "themes") {
    fetch(chrome.runtime.getURL("assets/themes.json"))
      .then((r) => r.json())
      .then((t) => sendResponse(t))
      .catch(() => sendResponse(null));
    return true;
  }
  if (msg?.type === "fetchText") {
    fetch(msg.url)
      .then(async (r) => sendResponse({ ok: r.ok, text: await r.text() }))
      .catch((e) => sendResponse({ ok: false, text: String(e) }));
    return true;
  }
  if (msg?.type !== "highlight") return;
  const fail = (err: any) => {
    console.warn("highlight failed:", msg.lang, err);
    sendResponse(null);
  };
  // dual form (a file's old+new sides in one round-trip); the single `text`
  // form is still used for expander context lines
  if (msg.old !== undefined || msg.new !== undefined) {
    const side = (t: string) => (t ? highlight(msg.lang, t) : Promise.resolve({ rows: {} }));
    Promise.all([side(msg.old), side(msg.new)]).then(
      ([o, n]) => sendResponse({ old: o.rows, new: n.rows }),
      fail
    );
    return true;
  }
  highlight(msg.lang, msg.text).then(sendResponse, fail);
  return true;
});