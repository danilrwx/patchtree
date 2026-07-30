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

// highlight.js fallback for languages without a tree-sitter grammar (and
// auto-detection for extensionless files). Only the curated set below is
// registered; the tree-sitter path always wins when a grammar exists.
import hljs from "highlight.js/lib/core";
import clojure from "highlight.js/lib/languages/clojure";
import cmake from "highlight.js/lib/languages/cmake";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import julia from "highlight.js/lib/languages/julia";
import kotlin from "highlight.js/lib/languages/kotlin";
import makefile from "highlight.js/lib/languages/makefile";
import objectivec from "highlight.js/lib/languages/objectivec";
import ocaml from "highlight.js/lib/languages/ocaml";
import perl from "highlight.js/lib/languages/perl";
import protobuf from "highlight.js/lib/languages/protobuf";
import r from "highlight.js/lib/languages/r";
import scala from "highlight.js/lib/languages/scala";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";

const LANGS = {
  clojure,
  cmake,
  dart,
  dockerfile,
  elixir,
  erlang,
  groovy,
  haskell,
  ini,
  julia,
  kotlin,
  makefile,
  objectivec,
  ocaml,
  perl,
  protobuf,
  r,
  scala,
  sql,
  swift,
};
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

// auto-detection over prose (LICENSE, CODEOWNERS…) must stay blank; below
// this relevance the winner is treated as a false positive
const MIN_AUTO_RELEVANCE = 5;

type Row = { s: number; e: number; c: string };
type Rows = Record<number, Row[]>;

const SCOPE: Record<string, string> = {
  keyword: "keyword",
  built_in: "type",
  type: "type",
  literal: "constant",
  symbol: "constant",
  number: "number",
  string: "string",
  regexp: "string",
  subst: "embedded",
  comment: "comment",
  doctag: "comment",
  quote: "comment",
  meta: "keyword",
  variable: "variable",
  "template-variable": "variable",
  property: "property",
  attr: "attribute",
  attribute: "attribute",
  name: "tag",
  "selector-tag": "tag",
  "selector-class": "type",
  "selector-id": "constant",
  "selector-attr": "attribute",
  "selector-pseudo": "function",
  operator: "operator",
  punctuation: "punctuation",
  bullet: "punctuation",
  section: "keyword",
  link: "string",
  title: "function",
};

function mapScope(attr: string): string | null {
  const parts = attr.split(" ");
  const primary = parts[0].replace(/^hljs-/, "").replace(/^language-.*/, "");
  const sub = parts[1]?.replace(/_$/, "");
  if (primary === "title") return sub === "class" || sub === "class.inherited" ? "type" : "function";
  if (primary === "char" && sub === "escape") return "escape";
  return SCOPE[primary] ?? null;
}

// hljs emits escaped HTML; the service worker has no DOM, so walk the span
// stream by hand. Offsets count original characters (each entity is one),
// rows split on newlines, nested unmapped scopes inherit the outer class.
export function htmlToRows(html: string): Rows {
  const rows: Rows = {};
  const stack: (string | null)[] = [];
  let row = 0;
  let col = 0;
  const emit = (n: number) => {
    const c = stack.length ? stack[stack.length - 1] : null;
    if (c) {
      const list = (rows[row] ||= []);
      const last = list[list.length - 1];
      if (last && last.e === col && last.c === c) last.e = col + n;
      else list.push({ s: col, e: col + n, c });
    }
    col += n;
  };
  const re = /<span class="([^"]*)">|<\/span>|&(?:amp|lt|gt|quot|#x27|#39);|\n|[^<&\n]+/g;
  for (const m of html.matchAll(re)) {
    const t = m[0];
    if (t[0] === "<") {
      if (t[1] === "/") stack.pop();
      else stack.push(mapScope(m[1]) ?? (stack.length ? stack[stack.length - 1] : null));
    } else if (t === "\n") {
      row++;
      col = 0;
    } else if (t[0] === "&") emit(1);
    else emit(t.length);
  }
  return rows;
}

export function hljsRows(name: string, text: string): Rows {
  try {
    if (name === "auto") {
      const res = hljs.highlightAuto(text, Object.keys(LANGS));
      if (!res.language || res.relevance < MIN_AUTO_RELEVANCE) return {};
      return htmlToRows(res.value);
    }
    return htmlToRows(hljs.highlight(text, { language: name, ignoreIllegals: true }).value);
  } catch {
    return {};
  }
}
