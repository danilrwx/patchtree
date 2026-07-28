# patchtree

Chrome extension: renders raw `.diff`/`.patch` URLs (GitLab/GitHub) as a
pretty diff with tree-sitter syntax highlighting, plus GitLab review actions.

## Features

- Auto-renders any `*.diff` / `*.patch` plain-text page; `raw` button toggles back.
- Syntax highlighting via web-tree-sitter (wasm) in the background service
  worker: go, js/ts/tsx, python, bash, json, yaml, rust, c, css, html.
- Toolbar click on the extension icon on a GitLab MR / GitHub PR page opens
  its `.diff` in a new tab.
- On GitLab `.diff` pages (any instance, incl. self-hosted):
  - shows existing diff-anchored discussions under their lines;
  - click a line number → inline comment form;
  - Approve / Unapprove, general Comment, Request changes buttons.

## Install

1. `chrome://extensions` → Developer mode → Load unpacked → this directory.
2. Extension options → add your GitLab host and a personal access token
   (scope `api`). Without a token the diff still renders and discussions are
   read via your session cookies, but write actions are disabled.

## Vendored assets

- `vendor/web-tree-sitter.{js,wasm}` — npm `web-tree-sitter`.
- `vendor/wasm/tree-sitter-*.wasm` — prebuilt wasm shipped in the official
  grammar npm packages (ABI-compatible with the runtime above).
- `queries/*.scm` — highlights queries from the grammar repos
  (yaml from helix-editor/helix).
