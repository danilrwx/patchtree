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

## Build from source

Binary assets (wasm grammars, fonts, highlight queries, theme data) are not
stored in git — `make` fetches them from pinned upstream releases, then bundles
the sources into `dist/`. Load `dist/` via `chrome://extensions` → Developer
mode → Load unpacked.

### Firefox

`make zip-firefox` builds `patchtree-firefox.zip` with an event-page
background and the gecko id. For development load it via
`about:debugging` → Load Temporary Add-on. Permanent installs come from
the AMO listing: on `v*` tags CI submits the version to the public AMO
channel for review when `AMO_JWT_ISSUER`/`AMO_JWT_SECRET` secrets are
configured. Firefox MV3 treats host permissions as opt-in — enable
“Access your data for all websites” in the add-on's Permissions tab.

### Build / release

- `make` — fetch pinned assets (`vendor`, `queries`, `fonts`, `themes`),
  `npm install`, and bundle the sources into `dist/` with esbuild; asset
  fetches skip when files are already present.
- `make check` — syntax-check the sources.
- `make typecheck` — `tsc --noEmit` over the TypeScript sources.
- `make test` — run the pure-logic checks in `test/run.mjs`.
- `make e2e` — Playwright end-to-end: loads the built extension against a PR
  `.diff` fixture with the adapter mocked (needs `npx playwright install
  chromium`). Runs in Chromium's new headless mode, which loads MV3
  extensions, so no window appears and no display is required;
  `PT_HEADED=1 make e2e` shows the browser when you need to watch it.
- `make zip` / `make zip-firefox` — bundle and archive `dist/`.
- `node scripts/scenes.mjs` — reshoot every gallery frame: 2x into
  `docs/screenshots/` for this README, and the first five at 1x into
  `docs/store/` for the Chrome Web Store and AMO listings.
- `node scripts/promo.mjs` — render the store promo images (440x280 tile and
  1400x560 marquee). Listing copy lives in
  [docs/store/LISTING.txt](docs/store/LISTING.txt) — plain text, since the
  Chrome Web Store renders neither markdown nor html.
- `make clean` — remove fetched assets, `dist/`, and archives.

CI (`.github/workflows/release.yml`) rebuilds every asset from the pinned
upstream versions on each push and attaches the archives plus sha256
checksums to the GitHub Release on `v*` tags — nothing binary is taken
from the repository, so artifact contents are fully traceable:

- `web-tree-sitter` + grammar wasm builds — npm packages
  (`scripts/fetch-vendor.sh`).
- Highlight queries — grammar repos at matching tags
  (`scripts/fetch-queries.sh`).
- Fonts — upstream releases, Nerd Font ttf converted to woff2 with the
  ttf2woff2 npm package (`scripts/fetch-fonts.sh`).
- Themes — tinted-theming schemes at a pinned commit
  (`scripts/fetch-themes.sh`).

To release: `git tag v1.3.0 && git push --tags`. CI generates the
release notes from conventional commits (`scripts/changelog.sh`).

## Everyday commands

| Command | What it does |
|---|---|
| `make` | Fetch assets, install deps, bundle sources into `dist/`. |
| `make lint` | Biome lint + the license-header check. |
| `make typecheck` | `tsc --noEmit` over the TypeScript sources. |
| `make test` | `check` + `lint` + `typecheck` + the pure-logic and provider unit tests. |
| `make e2e` | Playwright end-to-end against a mocked PR `.diff` (new headless Chromium; `PT_HEADED=1` to watch). First run: `npx playwright install chromium`. |
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
