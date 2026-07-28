// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Dependency-free checks for the pure logic in content.js. The file is a
// content script (not a module), so it is evaluated in a vm with stubbed
// browser globals; main() bails on the stub contentType, leaving the
// top-level function declarations reachable on the sandbox.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const sandbox = {
  window: {},
  document: { contentType: "", addEventListener() {}, documentElement: { classList: { add() {} } } },
  chrome: {
    runtime: { getURL: (p) => p, sendMessage: async () => ({}) },
    storage: {
      sync: { get: async () => ({}), set() {} },
      local: { get: async () => ({}), set() {} },
      onChanged: { addListener() {} },
    },
  },
  CSS: { escape: (s) => s },
  IntersectionObserver: class {
    observe() {}
  },
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => 0,
  console,
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("content.js", root), "utf8"), sandbox);
const { parseDiff, alignHunk, wordDiff, resolveLang, langFor, renderLineHTML } = sandbox;

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
  assert.ok(wd && wd.a.length && wd.b.length);
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

console.log(`\n${passed} checks passed`);
