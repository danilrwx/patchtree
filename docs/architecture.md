# Architecture

patchtree is a Manifest V3 browser extension that replaces the browser's
plain-text rendering of a `.diff` / `.patch` page with a full code-review UI.
It runs entirely client-side; the only network calls are to the diff's own host
(GitLab/GitHub) for review data.

## Pieces

```
manifest.json
├─ content_scripts → dist/content.js    the whole page UI (bundled)
└─ background      → dist/background.js  tree-sitter highlighter (ES module)
```

Everything the page shows is one bundle, `content.js`. The build inlines the
providers, the review controller and every Solid component into it (see
[Build](#build)). Tokens are configured in-page via ⚙ → Access tokens
(`<TokensDialog>`); there is no separate options page.

### `src/content.ts` — bootstrap + orchestration

Runs on a `text/plain` `.diff`/`.patch` page. It:

1. reads the raw diff from the page, `parseDiff`s it, and bails if it isn't one;
2. resolves the provider for the current URL (`makeProvider()`);
3. builds the page chrome (tree, toolbar, splitter, gear menu) and mounts the
   Solid components;
4. renders each file (`buildFileModel` → `<DiffFile>`) and kicks off syntax
   highlighting;
5. once the diff has painted, defers `initReview(provider, view)` so no network
   request blocks first paint.

It also owns the imperative bits that aren't worth componentising (font
injection, keyboard nav, splitter drag, a few gear menu items).

### `src/store.ts` — reactive state

The single source of truth, a set of SolidJS signals and stores: the file tree,
view mode, per-line syntax highlights, expander context, settings, and the
review layer (`reviewThreads`, `composing`, `fileLines`, and `reviewApi` — the
action bridge the thread components call). Components read the store; nothing
reaches across modules through `window` (only two static globals remain:
`ptIcons`, `ptCustomThemes`).

### `src/components/*` — SolidJS UI

`DiffFile` (unified + split tables, syntax + word-diff, expanders, and the
anchored comment rows), `FileTree`, `Toolbar`, `Settings` + `Select`,
`CommentForm`, `Thread` (with `Note`, `Suggestion`, `ThreadActions`,
`GeneralThreads`), `TokensDialog`, `ThemeGallery`. Rendering is fine-grained:
comment rows are keyed by `(path, side, line)`, so a reply or resolve re-renders
only the touched thread — never the whole diff.

### `src/diff.ts` — pure diff logic

No DOM, no framework: unified-diff parsing (git-format and plain `diff -u`,
including renames and binary files), the split-view line pairing, per-line
render model, word-diff (LCS over tokens), and the highlight-to-HTML step. This
is what the unit tests in `test/run.mjs` exercise.

### `src/providers.ts` — the host abstraction

One normalized `Provider` interface (`src/types.ts`) with two implementations —
GitLab (any instance; REST + GraphQL) and GitHub (GraphQL with a REST
fallback). `makeProvider()` matches the page URL and returns the adapter, or
`null` for a local `file://` patch (which renders read-only). Tokens live in
`storage.local` and are never synced.

### `src/review.ts` — the review controller

`initReview(provider, view)` loads threads and drafts into the store, wires the
`reviewApi` actions (reply, resolve, edit, delete, submit, suggestions), and
handles line-comment clicks. Each action hits the provider then updates the
store surgically.

### `background.js` — the highlighter

An ES-module service worker running web-tree-sitter (wasm). It answers
`highlight` messages (parse text → per-line capture ranges), serves
`themes.json` and cross-origin `fetchText` requests, and opens the pretty diff
when the toolbar icon is clicked. It stays unbundled because it imports the
vendored wasm loader by URL.

## Data flow

```
page load
  └─ content.ts main()
       ├─ parseDiff → buildFileModel → <DiffFile> (renders from the store)
       ├─ highlightSide ─▶ background (tree-sitter) ─▶ store.highlights ─▶ rerender cells
       └─ initReview(provider) ─▶ provider.threads() ─▶ store.reviewThreads
                                                          └─▶ <DiffFile> anchors comment rows
```

## Build

`build.mjs` runs esbuild once per entry into `dist/`:

- `content` — bundled (Solid runtime inlined), IIFE.
- `background` — ES module, **not** bundled (imports the vendored loader).

`assets/` (fetched wasm/fonts/queries/themes + committed icons) is mirrored to
`dist/assets/`; `manifest.json`, `options.html` and `viewer.css` sit at the
`dist/` root. The binary assets are pinned and fetched by `scripts/fetch-*.sh`,
never committed — CI rebuilds them from the pinned upstream versions so the
release artifacts are fully traceable.

TypeScript is strict; JSX uses `jsxImportSource: "solid-js"`.

## Testing

- `test/run.mjs` — pure diff logic (parse, align, word-diff, render, model).
- `test/providers.mjs` — both adapters, every interface method, against a
  mocked `fetch` and `storage` in a `vm` sandbox.
- `test/e2e/` — Playwright loads the built extension against a PR `.diff`
  fixture with the provider mocked (headed Chromium), covering render, tree,
  settings, themes, tokens and the review flows (comment/reply/resolve/edit/
  delete/suggestion/multiline).
