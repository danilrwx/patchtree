# Contributing to patchtree

Thanks for helping out. patchtree is a Chrome/Firefox MV3 extension that
renders raw `.diff` / `.patch` pages as a full code-review UI. This guide
covers the dev setup and the conventions the project follows.

## Prerequisites

- Node.js 22+ and npm.
- A Chromium-based browser (for loading the unpacked extension) and/or
  Firefox.
- `make` (the build is driven from the `Makefile`).

Binary assets (wasm grammars, fonts, highlight queries, theme data) are **not**
committed — they are fetched from pinned upstream releases on the first build.

## Getting started

```sh
git clone https://github.com/danilrwx/patchtree
cd patchtree
make          # fetch pinned assets + npm install + bundle into dist/
make hooks    # install the pre-commit hook (lint + typecheck)
```

Load `dist/` as an unpacked extension (`chrome://extensions` → Developer mode →
Load unpacked), then open any `.diff` / `.patch` URL. See
[docs/user-guide.md](docs/user-guide.md) for usage and
[docs/architecture.md](docs/architecture.md) for how it fits together.

## Everyday commands

| Command | What it does |
|---|---|
| `make` | Fetch assets, install deps, bundle sources into `dist/`. |
| `make lint` | Biome lint + the license-header check. |
| `make typecheck` | `tsc --noEmit` over the TypeScript sources. |
| `make test` | `check` + `lint` + `typecheck` + the pure-logic and provider unit tests. |
| `make e2e` | Playwright end-to-end against a mocked PR `.diff` (headed Chromium; `xvfb-run make e2e` on Linux). First run: `npx playwright install chromium`. |
| `make zip` / `make zip-firefox` | Archive `dist/` for the Chrome / Firefox stores (into `build/`). |
| `make clean` | Remove fetched assets, `dist/`, `build/`. |

Run `make test` before opening a PR; run `make e2e` when you touch rendering,
the review layer, or the providers.

## Code layout

Source lives in `src/` (TypeScript + SolidJS), assets in `assets/`, tests in
`test/`. The entry points build to `dist/`: `content.js` (the whole page UI) and
`background.js` (the tree-sitter highlighter service worker). See
[docs/architecture.md](docs/architecture.md) for the full picture.

## Conventions

- **TypeScript, strict.** New code is typed; avoid `any` except at genuinely
  dynamic boundaries (network JSON), and note why.
- **SolidJS** for UI — render from the store, avoid imperative DOM.
- **Biome** formats and lints (`make lint` must be clean; a11y interaction
  rules may warn). Run it before committing.
- **License header** — every source file (`.ts/.tsx/.js/.mjs/.css/.html/.sh`,
  `Makefile`) starts with the Apache 2.0 notice; `scripts/check-headers.mjs`
  enforces it.
- **Tests** — cover pure logic in `test/run.mjs`, provider adapters in
  `test/providers.mjs`, and user-visible flows in `test/e2e/`. Add a test with
  behavioural changes.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org): `feat:`,
  `fix:`, `refactor:`, `docs:`, `test:`, `chore:` (optional scope).
- Sign off every commit: `git commit -s` (Developer Certificate of Origin).
- One logical change per commit; keep the working tree green (`make test`).

## Pull requests

- Branch off `main`; don't push to `main` directly.
- Describe what changed and why; link any issue.
- Make sure `make test` (and `make e2e` when relevant) pass.
- The changelog is generated from commit messages — no manual `CHANGELOG.md`
  edits needed.

## Licensing

By contributing you agree your changes are released under the project's
[Apache License 2.0](LICENSE).
