# patchtree

Chrome extension: renders raw `.diff`/`.patch` URLs as a pretty diff with
tree-sitter syntax highlighting and a full review workflow for GitLab
(any instance) and GitHub.

## Features

- Auto-renders any `*.diff` / `*.patch` plain-text page; inline and
  side-by-side views with word-level diff highlighting.
- Syntax highlighting via web-tree-sitter (wasm) in the background service
  worker: go, js/ts/tsx, python, bash, json, yaml, rust, c, css, html.
- Resizable file tree with filtering (by path and by diff content),
  per-file fold, viewed state with progress, generated-file auto-collapse.
- Expand hidden lines between hunks / full file view.
- Review (provider interface, GitLab + GitHub implementations): threads
  with markdown preview and suggestion widgets, single/multiline comments,
  replies, edit/delete, resolve (GitLab), draft reviews (GitLab), apply
  suggestion (GitLab), approve / request changes, commit filter, pipeline
  status, unresolved-threads navigator.
- Keyboard: `j/k` files, `n/p` threads, `v` viewed, `x` fold, `/` filter;
  alt-click a line number copies a blob permalink.
- Themes: GitHub light/dark plus base16 (built-in schemes and custom
  tinted-theming yaml), bundled fonts (JetBrains Mono, Inter, Nerd Font
  Mono variants), font/tab-size settings.

## Install

Binary assets (wasm grammars, fonts, highlight queries) are not stored in
git — they are fetched from pinned upstream releases:

```sh
git clone https://github.com/danilrwx/patchtree
cd patchtree
make          # fetches vendor/, queries/, fonts/ (needs node+npm, curl, python3 with fonttools+brotli)
```

Then `chrome://extensions` → Developer mode → Load unpacked → this
directory. In the extension options add your GitLab host (PAT scope
`api`) and/or `github.com` (classic PAT with `repo`) to enable review
actions; rendering works without tokens.

Make sure the extension's **Site access** is set to “On all sites”, or
grant your GitLab/GitHub hosts explicitly — without it the content script
is not injected.

## Build / release

- `make` (default) — fetch all pinned binary assets (`make vendor`,
  `make queries`, `make fonts`).
- `make check` — syntax-check the sources.
- `make zip` — build `patchtree.zip` for distribution.

CI (`.github/workflows/release.yml`) rebuilds every binary asset from the
pinned upstream versions on each push and attaches `patchtree.zip` plus a
sha256 checksum to the GitHub Release on `v*` tags — nothing binary is
taken from the repository itself, so the artifact contents are fully
traceable to their sources:

- `web-tree-sitter` and grammar wasm builds — npm packages (versions
  pinned in `scripts/fetch-vendor.sh`).
- Highlight queries — grammar repos at the matching tags
  (`scripts/fetch-queries.sh`).
- Fonts — JetBrains Mono, Inter and Nerd Fonts releases
  (`scripts/fetch-fonts.sh`), Nerd Font ttf converted to woff2 with
  fontTools during the build.

To release: tag a commit (`git tag v0.2.0 && git push --tags`).
