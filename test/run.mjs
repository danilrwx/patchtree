// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Checks for the pure logic in src/diff.ts (transpiled with esbuild and loaded
// as a CommonJS module) plus the changelog script and provider URL routing.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const require = createRequire(import.meta.url);

function loadTs(rel) {
  const { code } = transformSync(readFileSync(new URL(rel, root), "utf8"), {
    loader: "ts",
    format: "cjs",
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, require);
  return module.exports;
}

const { parseDiff, alignHunk, wordDiff, resolveLang, langFor, renderLineHTML, buildFileModel, rowMeta } =
  loadTs("src/diff.ts");

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
  assert.ok(repl.wdB && repl.wdB.length, "word-diff on the new side");
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

// providers.ts is TypeScript; transpile it (types stripped) and run its
// URL-routing in a vm with stubbed globals. Construction is network-free, so
// this checks the module loads and routes each host to the right provider.
function loadProvider(loc) {
  const src = readFileSync(new URL("src/providers.ts", root), "utf8");
  const { code } = transformSync(src, { loader: "ts" });
  const win = {};
  const sb = {
    window: win,
    location: loc,
    chrome: {
      storage: { local: { get: async () => ({}) }, sync: { get: async () => ({}), remove() {} } },
      runtime: { sendMessage: async () => ({}) },
    },
  };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return win.ptProvider;
}

t("providers route a GitLab MR", () => {
  const p = loadProvider({
    host: "gitlab.example.com",
    origin: "https://gitlab.example.com",
    pathname: "/group/sub/proj/-/merge_requests/104.diff",
    href: "https://gitlab.example.com/group/sub/proj/-/merge_requests/104.diff",
  });
  assert.equal(p.kind, "gitlab");
  assert.equal(p.can.drafts, true);
  assert.equal(typeof p.postThread, "function");
});

t("providers route a GitHub PR", () => {
  const p = loadProvider({ host: "github.com", pathname: "/owner/repo/pull/7.diff" });
  assert.equal(p.kind, "github");
  assert.equal(p.can.drafts, false);
  assert.equal(p.drafts, undefined);
});

t("providers are null on an unrelated page", () => {
  assert.equal(loadProvider({ host: "example.com", pathname: "/whatever.diff" }), null);
});

console.log(`\n${passed} checks passed`);
