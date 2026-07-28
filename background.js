import { Parser, Language, Query } from "./vendor/web-tree-sitter.js";

// typescript files are parsed with the tsx grammar so one wasm covers ts/tsx,
// and its query is the javascript query plus typescript additions
const GRAMMAR = { typescript: "tsx" };
const QUERY_PARTS = { typescript: ["javascript", "typescript"] };

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

function highlight(langName, text) {
  return init()
    .then(() => loadLang(langName))
    .then(({ language, query }) => {
      parser.setLanguage(language);
      const tree = parser.parse(text);
      if (!tree) return { rows: {} };

      const lineStarts = [0];
      for (let i = 0; i < text.length; i++)
        if (text[i] === "\n") lineStarts.push(i + 1);

      const rows = {};
      const captures = query.captures(tree.rootNode);
      const n = Math.min(captures.length, MAX_CAPTURES);
      for (let i = 0; i < n; i++) {
        const { name, node } = captures[i];
        const c = cssClass(name);
        const sr = node.startPosition.row;
        const er = node.endPosition.row;
        for (let row = sr; row <= er; row++) {
          const lineStart = lineStarts[row];
          const lineEnd = row + 1 < lineStarts.length ? lineStarts[row + 1] - 1 : text.length;
          const s = Math.max(node.startIndex, lineStart) - lineStart;
          const e = Math.min(node.endIndex, lineEnd) - lineStart;
          if (e <= s) continue;
          (rows[row] ||= []).push({ s, e, c });
        }
      }
      tree.delete();
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
  if (msg?.type !== "highlight") return;
  highlight(msg.lang, msg.text).then(sendResponse, (err) => {
    console.warn("highlight failed:", msg.lang, err);
    sendResponse(null);
  });
  return true;
});
