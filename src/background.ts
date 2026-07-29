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

// path is relative to the built dist/background.js (unbundled ES module); the
// vendored loader is fetched at build time and resolved at runtime, not by tsc
// @ts-expect-error — no types for the vendored web-tree-sitter loader
import { Parser, Language, Query } from "./assets/vendor/web-tree-sitter.js";

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

function cssClass(captureName: string): string {
  // mapping keys / struct fields get their own color, not the generic variable
  if (captureName.startsWith("variable.other.member")) return "property";
  return captureName.split(".")[0];
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
  if (langName === "gotmpl") return highlightGotmpl(text);
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

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.url) return;
  const gl = /^(https?:\/\/[^?#]*\/-\/merge_requests\/\d+)/.exec(tab.url);
  const gh = /^(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/.exec(tab.url);
  const base = gl?.[1] || gh?.[1];
  if (base) chrome.tabs.create({ url: `${base}.diff`, index: tab.index + 1 });
});

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