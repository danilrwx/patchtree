// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
import { Parser, Language, Query } from "./vendor/web-tree-sitter.js";

// typescript files are parsed with the tsx grammar so one wasm covers ts/tsx,
// and its query is the javascript query plus typescript additions
const GRAMMAR = { typescript: "tsx" };
const QUERY_PARTS = { typescript: ["javascript", "typescript"], cpp: ["c", "cpp"] };

const MAX_CAPTURES = 50000;

let ready;
let parser;
const langs = new Map();

function init() {
  if (!ready) {
    ready = Parser.init({
      locateFile: () => chrome.runtime.getURL("vendor/web-tree-sitter.wasm"),
    }).then(() => {
      parser = new Parser();
    });
  }
  return ready;
}

async function loadLang(name) {
  if (langs.has(name)) return langs.get(name);
  const p = (async () => {
    const grammar = GRAMMAR[name] || name;
    const language = await Language.load(
      chrome.runtime.getURL(`vendor/wasm/tree-sitter-${grammar}.wasm`)
    );
    const parts = QUERY_PARTS[name] || [name];
    const sources = await Promise.all(
      parts.map((q) =>
        fetch(chrome.runtime.getURL(`queries/${q}.scm`)).then((r) => r.text())
      )
    );
    const query = new Query(language, sources.join("\n"));
    return { language, query };
  })();
  langs.set(name, p);
  p.catch(() => langs.delete(name));
  return p;
}

function cssClass(captureName) {
  return captureName.split(".")[0];
}

function lineStartsOf(text) {
  const ls = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") ls.push(i + 1);
  return ls;
}

// split a [startIndex,endIndex) span into per-line {s,e,c} entries
function pushSpan(rows, startIndex, endIndex, c, lineStarts, text, rowOf) {
  const sr = rowOf(startIndex);
  const er = rowOf(endIndex);
  for (let row = sr; row <= er; row++) {
    const lineStart = lineStarts[row];
    const lineEnd = row + 1 < lineStarts.length ? lineStarts[row + 1] - 1 : text.length;
    const s = Math.max(startIndex, lineStart) - lineStart;
    const e = Math.min(endIndex, lineEnd) - lineStart;
    if (e > s) (rows[row] ||= []).push({ s, e, c });
  }
}

function parseWith(language, text) {
  parser.setLanguage(language);
  return parser.parse(text);
}

function highlight(langName, text) {
  if (langName === "gotmpl") return highlightGotmpl(text);
  return init()
    .then(() => loadLang(langName))
    .then(({ language, query }) => {
      const tree = parseWith(language, text);
      if (!tree) return { rows: {} };
      const lineStarts = lineStartsOf(text);
      const rows = {};
      const captures = query.captures(tree.rootNode);
      const n = Math.min(captures.length, MAX_CAPTURES);
      for (let i = 0; i < n; i++) {
        const { name, node } = captures[i];
        const c = cssClass(name);
        for (let row = node.startPosition.row; row <= node.endPosition.row; row++) {
          const lineStart = lineStarts[row];
          const lineEnd = row + 1 < lineStarts.length ? lineStarts[row + 1] - 1 : text.length;
          const s = Math.max(node.startIndex, lineStart) - lineStart;
          const e = Math.min(node.endIndex, lineEnd) - lineStart;
          if (e > s) (rows[row] ||= []).push({ s, e, c });
        }
      }
      tree.delete();
      return { rows };
    });
}

// Helm/Go templates: yaml is injected into the template's text spans
// (like nvim-treesitter's gotmpl injections) — yaml highlights the plain
// content, gotmpl highlights the {{ … }} actions on top.
function highlightGotmpl(text) {
  return init()
    .then(() => Promise.all([loadLang("gotmpl"), loadLang("yaml")]))
    .then(([gt, yaml]) => {
      const lineStarts = lineStartsOf(text);
      const rowOf = (idx) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (lineStarts[mid] <= idx) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      };
      const rows = {};

      const gtTree = parseWith(gt.language, text);
      // collect (text) node spans — the parts outside {{ … }} where yaml applies
      const textSpans = [];
      const walk = (node) => {
        if (node.type === "text") textSpans.push([node.startIndex, node.endIndex]);
        for (let i = 0; i < node.childCount; i++) walk(node.child(i));
      };
      walk(gtTree.rootNode);
      const insideText = (s, e) => textSpans.some(([ts, te]) => ts <= s && e <= te);

      const yamlTree = parseWith(yaml.language, text);
      for (const { name, node } of yaml.query.captures(yamlTree.rootNode).slice(0, MAX_CAPTURES))
        if (insideText(node.startIndex, node.endIndex))
          pushSpan(rows, node.startIndex, node.endIndex, cssClass(name), lineStarts, text, rowOf);
      yamlTree.delete();

      for (const { name, node } of gt.query.captures(gtTree.rootNode).slice(0, MAX_CAPTURES))
        pushSpan(rows, node.startIndex, node.endIndex, cssClass(name), lineStarts, text, rowOf);
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
  if (msg?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg?.type === "themes") {
    fetch(chrome.runtime.getURL("themes.json"))
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
  highlight(msg.lang, msg.text).then(sendResponse, (err) => {
    console.warn("highlight failed:", msg.lang, err);
    sendResponse(null);
  });
  return true;
});