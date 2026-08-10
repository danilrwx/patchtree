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

// Checks for the pure logic in src/diff.ts (transpiled with esbuild and loaded
// as a CommonJS module) plus the changelog script and provider URL routing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const require = createRequire(import.meta.url);
const covDir = fileURLToPath(new URL("test-results/covtmp", root));
mkdirSync(covDir, { recursive: true });

// the transpiled module goes through a real file with an inline source map so
// NODE_V8_COVERAGE (make coverage) can attribute hits back to src/*.ts
function loadTs(rel) {
  const srcPath = fileURLToPath(new URL(rel, root));
  const { code } = transformSync(readFileSync(srcPath, "utf8"), {
    loader: "ts",
    format: "cjs",
    sourcemap: "inline",
    sourcefile: srcPath,
  });
  const out = `${covDir}/${rel.replace(/[/.]/g, "_")}.cjs`;
  writeFileSync(out, code);
  return require(out);
}

const {
  parseDiff,
  alignHunk,
  wordDiff,
  resolveLang,
  langFor,
  renderLineHTML,
  buildFileModel,
  rowMeta,
  imageMime,
  isImagePath,
  renderPreambleHTML,
  treeOrder,
} = loadTs("src/diff.ts");

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const DIFF = `diff --git a/main.go b/main.go
--- a/main.go
+++ b/main.go
@@ -1,3 +1,3 @@
 package main
-const x = 1
+const x = 2
`;

t("parseDiff basics", () => {
  const { files } = parseDiff(DIFF);
  assert.equal(files.length, 1);
  assert.equal(files[0].newPath, "main.go");
  assert.equal(files[0].hunks.length, 1);
  const kinds = files[0].hunks[0].lines.map((l) => l.t).join("");
  assert.ok(kinds.includes("-") && kinds.includes("+"));
});

t("parseDiff reads a plain unified diff (no diff --git, no a//b/)", () => {
  const plain = `--- old/a.go
+++ new/a.go
@@ -1,2 +1,2 @@
 package a
-x := 1
+x := 2
--- b.py
+++ b.py
@@ -1 +1 @@
-y = 1
+y = 2
`;
  const { files } = parseDiff(plain);
  assert.equal(files.length, 2);
  assert.equal(files[0].oldPath, "old/a.go");
  assert.equal(files[0].newPath, "new/a.go");
  assert.equal(files[0].hunks.length, 1);
  assert.equal(files[1].newPath, "b.py");
  assert.equal(files[1].hunks[0].lines.map((l) => l.t).join("").slice(0, 2), "-+");
});

t("parseDiff maps /dev/null to new/deleted", () => {
  const added = parseDiff("--- /dev/null\n+++ n.go\n@@ -0,0 +1 @@\n+hi\n");
  assert.equal(added.files[0].isNew, true);
  assert.equal(added.files[0].newPath, "n.go");
});

t("parseDiff names pure renames and binary files (no ---/+++)", () => {
  const rename = parseDiff(
    "diff --git a/old.png b/new dir/img.png\n" +
      "similarity index 100%\nrename from old.png\nrename to new dir/img.png\n"
  ).files[0];
  assert.equal(rename.oldPath, "old.png");
  assert.equal(rename.newPath, "new dir/img.png");
  assert.equal(rename.hunks.length, 0);

  const bin = parseDiff(
    "diff --git a/logo.png b/logo.png\ndeleted file mode 100644\n" +
      "Binary files a/logo.png and /dev/null differ\n"
  ).files[0];
  assert.equal(bin.newPath, "logo.png"); // path recovered from the diff --git line
  assert.equal(bin.binary, true);
});

t("parseDiff flags rename only on rename headers, not differing ---/+++", () => {
  // git rename → isRenamed
  const renamed = parseDiff(
    "diff --git a/old.go b/new.go\nsimilarity index 90%\nrename from old.go\nrename to new.go\n" +
      "--- a/old.go\n+++ b/new.go\n@@ -1 +1 @@\n-x\n+y\n"
  ).files[0];
  assert.equal(renamed.isRenamed, true);

  // a `diff -up dir1/f dir2/f` tool diff has different ---/+++ paths for the
  // SAME file — not a rename, and not new/deleted (it has context)
  const tool = parseDiff(
    "--- ../old/config.h\t2020\n+++ ./config.h\t2020\n@@ -1,3 +1,3 @@\n ctx\n-a\n+b\n more\n"
  ).files[0];
  assert.ok(!tool.isRenamed);
  assert.ok(!tool.isNew && !tool.isDeleted);
});

t("parseDiff derives add/delete from hunks in a plain diff", () => {
  const added = parseDiff("--- a/n.go\n+++ b/n.go\n@@ -0,0 +1,2 @@\n+one\n+two\n").files[0];
  assert.equal(added.isNew, true);
  const removed = parseDiff("--- a/g.go\n+++ b/g.go\n@@ -1,2 +0,0 @@\n-one\n-two\n").files[0];
  assert.equal(removed.isDeleted, true);
});

t("parseDiff keeps a No-newline marker and copy paths", () => {
  const nonl = parseDiff("--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n").files[0];
  assert.ok(nonl.hunks[0].lines.some((l) => l.t === "\\"));

  const copied = parseDiff("diff --git a/x b/y\ncopy from x\ncopy to y\n").files[0];
  assert.equal(copied.oldPath, "x");
  assert.equal(copied.newPath, "y");
  assert.ok(!copied.isRenamed); // a copy is not a rename
});

t("imageMime / isImagePath recognise image files", () => {
  assert.equal(imageMime("a/b/logo.png"), "image/png");
  assert.equal(imageMime("icon.SVG"), "image/svg+xml");
  assert.equal(imageMime("main.go"), null);
  assert.equal(isImagePath("x.jpeg"), true);
  assert.equal(isImagePath("x.txt"), false);
});

t("alignHunk pairs a replacement", () => {
  const { files } = parseDiff(DIFF);
  const pairs = alignHunk(files[0].hunks[0]);
  const repl = pairs.find((p) => p.old && p.new && !p.ctx);
  assert.ok(repl, "expected a paired -/+ line");
  assert.equal(repl.old.text, "const x = 1");
  assert.equal(repl.new.text, "const x = 2");
});

t("wordDiff marks only the changed token", () => {
  const wd = wordDiff("const x = 1", "const x = 2");
  assert.ok(wd?.a.length && wd.b.length);
  assert.equal(wd.b[0].c, "word-add");
  // the changed span should be the "2", not the whole line
  assert.ok(wd.b[0].e - wd.b[0].s <= 1);
});

t("wordDiff bails on unrelated lines", () => {
  assert.equal(wordDiff("aaaa", "zzzz zzzz zzzz"), null);
});

t("langFor by extension", () => {
  assert.equal(langFor("a/b/main.go"), "go");
  assert.equal(langFor("x.rs"), "rust");
  assert.equal(langFor("nope.xyz"), null);
});

t("resolveLang routes helm/werf/yaml", () => {
  assert.equal(resolveLang("templates/_helpers.tpl", ""), "gotmpl");
  assert.equal(resolveLang("werf.yaml", "plain: yes"), "gotmpl");
  assert.equal(resolveLang("a.werf.inc.yaml", ""), "gotmpl");
  assert.equal(resolveLang("t.yaml", "kind: {{ .x }}"), "gotmpl");
  assert.equal(resolveLang("plain.yaml", "kind: Pod"), "yaml");
  assert.equal(resolveLang("main.go", "x"), "go");
});

t("resolveLang falls back to hljs for grammarless languages", () => {
  assert.equal(resolveLang("Sources/App.swift", ""), "hljs:swift");
  assert.equal(resolveLang("db/schema.sql", ""), "hljs:sql");
  assert.equal(resolveLang("proj/Makefile", ""), "hljs:makefile");
  assert.equal(resolveLang("notes.xyz", "text"), null);
});

t("dockerfile resolves to the tree-sitter grammar by basename or extension", () => {
  assert.equal(resolveLang("Dockerfile", ""), "dockerfile");
  assert.equal(resolveLang("build/Containerfile", ""), "dockerfile");
  assert.equal(resolveLang("app.dev.dockerfile", ""), "dockerfile");
});

t("resolveLang: extensionless files use shebang, then hljs auto-detect", () => {
  assert.equal(resolveLang("scripts/run", "#!/usr/bin/env bash\necho hi"), "bash");
  assert.equal(resolveLang("scripts/gen", "#!/usr/bin/env python3\nprint(1)"), "python");
  assert.equal(resolveLang("bin/fix", "#!/usr/bin/perl\nprint 1;"), "hljs:perl");
  assert.equal(resolveLang("queries", "SELECT 1;"), "hljs:auto");
  assert.equal(resolveLang("empty", "   "), null);
});

const { htmlToRows, hljsRows } = loadTs("src/hljs.ts");

t("htmlToRows: spans, entities and newlines map to original offsets", () => {
  const rows = htmlToRows(
    '<span class="hljs-keyword">let</span> x = &quot;a&amp;b&quot;\n<span class="hljs-number">42</span>'
  );
  assert.deepEqual(rows[0], [{ s: 0, e: 3, c: "keyword" }]);
  assert.deepEqual(rows[1], [{ s: 0, e: 2, c: "number" }]);
});

t("htmlToRows: nested unmapped scopes inherit, sub-scopes map", () => {
  const rows = htmlToRows(
    '<span class="hljs-string">&quot;a<span class="hljs-subst">x</span>b&quot;</span> <span class="hljs-title function_">go</span>'
  );
  assert.deepEqual(rows[0], [
    { s: 0, e: 2, c: "string" },
    { s: 2, e: 3, c: "embedded" },
    { s: 3, e: 5, c: "string" },
    { s: 6, e: 8, c: "function" },
  ]);
});

t("hljsRows highlights a grammarless language", () => {
  const rows = hljsRows("swift", "func greet() -> String {}");
  assert.deepEqual(rows[0][0], { s: 0, e: 4, c: "keyword" });
});

t("hljsRows auto-detects code but leaves prose alone", () => {
  const sql = hljsRows("auto", "SELECT id, name\nFROM users\nWHERE active = TRUE\nORDER BY name;");
  assert.ok(Object.keys(sql).length > 0, "sql detected");
  const prose = hljsRows("auto", "This project renders diffs.\nSee the docs for details.");
  assert.deepEqual(prose, {});
});

t("renderPreambleHTML colours a format-patch message", () => {
  const html = renderPreambleHTML(
    [
      "From 782f63d8f858b1c14df38aaf623438d7ea2f75e1 Mon Sep 17 00:00:00 2001",
      "From: mihirlad55 <mihirlad55@gmail.com>",
      "Subject: [PATCH] Add support for managing external status bars",
      "",
      "Developed at https://github.com/mihirlad55/dwm-anybar",
      "---",
      " config.def.h |  3 ++",
      " dwm.c        | 20 ++++----",
      " 2 files changed, 103 insertions(+), 14 deletions(-)",
    ].join("\n")
  );
  const line = (n) => html.split("\n")[n];

  // mbox line: keyword + the commit sha
  assert.match(line(0), /pt-keyword">From <\/span><span class="pt-constant">782f63d8/);
  // headers keep their key coloured, and the subject stands out
  assert.match(line(1), /pt-keyword">From:<\/span>/);
  assert.match(line(2), /pt-strong">\[PATCH\] Add support/);
  // the angle brackets in the address survive as text, not markup
  assert.match(line(1), /&lt;mihirlad55@gmail\.com&gt;/);
  // urls in the body become links
  assert.match(line(4), /<a href="https:\/\/github\.com\/mihirlad55\/dwm-anybar"/);
  // diffstat: path, count, then plus/minus runs in the diff colours
  assert.match(line(6), /pt-property">config\.def\.h<\/span>/);
  assert.match(line(6), /pt-adds">\+\+<\/span>/);
  assert.match(line(7), /pt-adds">\+\+\+\+<\/span><span class="pt-dels">----<\/span>/);
  assert.match(line(8), /pt-adds">103 insertions\(\+\)<\/span>/);
  assert.match(line(8), /pt-dels">14 deletions\(-\)<\/span>/);
});

t("renderPreambleHTML escapes html and leaves plain prose alone", () => {
  const html = renderPreambleHTML("a <script>alert(1)</script> & co\nplain line");
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; co/);
  assert.equal(html.split("\n")[1], "plain line");
});

t("renderLineHTML: identical span keeps the last capture", () => {
  const html = renderLineHTML(
    "key",
    [
      { s: 0, e: 3, c: "string" },
      { s: 0, e: 3, c: "property" },
    ],
    null
  );
  assert.ok(html.includes("pt-property"), html);
  assert.ok(!html.includes("pt-string"), html);
});

t("buildFileModel: rows, texts, word-diff and meta", () => {
  const { files } = parseDiff(DIFF);
  const m = buildFileModel(files[0]);
  assert.equal(m.path, "main.go");
  assert.equal(m.segments.length, 1);
  const pairs = m.segments[0].pairs;
  // ctx line then the -/+ replacement
  assert.equal(pairs[0].ctx, true);
  assert.deepEqual([pairs[0].oldRow, pairs[0].newRow], [0, 0]);
  const repl = pairs.find((p) => !p.ctx);
  assert.deepEqual([repl.oldRow, repl.newRow], [1, 1]);
  assert.ok(repl.wdB?.length, "word-diff on the new side");
  assert.ok(m.newText.startsWith("package main\nconst x = 2"), m.newText);
  // the add row's meta carries new + both line codes
  const meta = rowMeta(m, null, repl.new, false);
  assert.equal(meta.new, repl.new.no);
  assert.equal(meta.codeNew, repl.new.no);
  assert.equal(String(meta.codeOld), String(repl.new.other));
});

// changelog.sh groups conventional commits by type. Use root..HEAD so the
// range is non-empty regardless of where tags currently point.
t("changelog.sh groups commits by type", () => {
  const script = new URL("scripts/changelog.sh", root).pathname;
  const rootCommit = execSync("git rev-list --max-parents=0 HEAD")
    .toString()
    .trim()
    .split("\n")[0];
  const out = execSync(`'${script}' ${rootCommit}..HEAD`, { shell: "/bin/bash" }).toString();
  assert.ok(/### .*Features/.test(out), out);
  assert.ok(/### .*Fixes/.test(out), out);
  // scoped commits render the scope in bold
  assert.ok(/^- (\*\*[\w.-]+:\*\* )?.+ \(`[0-9a-f]+`\)$/m.test(out), out);
});

t("treeOrder: folders before files, names in code unit order", () => {
  const paths = ["go.work.sum", "src/app/main.go", "go.work", "src/go.mod", "templates/a.yaml"];
  paths.sort(treeOrder);
  assert.deepEqual(paths, ["src/app/main.go", "src/go.mod", "templates/a.yaml", "go.work", "go.work.sum"]);
  // plain UTF-16 order like git's bytes, not locale order (which puts _ before .)
  assert.deepEqual(["pkg/dra_test.go", "pkg/dra.go"].sort(treeOrder), ["pkg/dra.go", "pkg/dra_test.go"]);
});

// Provider URL routing lives in test/providers.mjs (it needs the CJS transform
// and a fetch harness); this runner covers the pure diff logic + changelog.

console.log(`\n${passed} checks passed`);
