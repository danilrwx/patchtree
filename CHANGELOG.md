# Changelog

All notable changes, grouped from [conventional commits](https://www.conventionalcommits.org).

## v1.1.0

### 🚀 Features

- **highlight:** highlight.js fallback for grammarless languages (`ef847d7`)
- **theme:** use base24 bright accents on dark schemes (`6bd3c15`)
- **settings:** word-diff toggle, always on inside suggestions (`aee73d1`)
- **theme:** make UI chrome follow the applied scheme (`ebaaa55`)
- **files:** add collapse all / expand all to the gear menu (`55f8dde`)
- **toolbar:** show a diff summary of file count and total +/- (`c0ede8a`)
- **review:** show source→target branch with a copy button (`ff20fb0`)
- **nav:** key shortcuts off physical key so they work on any layout (`73a3c20`)
- **review:** spinner while a comment submit is in flight (`1c774ff`)
- **review:** edit "Update" label, explicit delete confirm + spinner, contained comments (`131419f`)
- **diff:** preview binary image files (old/new) instead of 'binary file' (`e57cae7`)
- **review:** collapse resolved threads to a one-line summary (`8005f0d`)
- **review:** drag to select a line range; offer suggestions in the inline form (`dc31245`)
- **sidebar:** add 'e' hotkey to toggle the tree; pad code left of the gutter (`4a78a74`)
- **sidebar:** centre the active file in the tree while scrolling (`85f5da9`)
- **sidebar:** collapse toggle, extension filter, scroll-spy and per-status icons (`2b3874c`)
- show a rename's path change as a word diff, drop the tooltip (`559c6d4`)
- base24-only theme gallery with a diff preview (`52d9e6a`)
- show the replaced lines in a suggestion widget (`8656c11`)
- restore multi-line comment ranges in the reactive review layer (`a7aa51c`)
- render local file:// patches (`fef75c9`)

### 🐛 Fixes

- **ui:** portal the select menu out of the scrollable gear menu (`10cf6d5`)
- **ui:** breathing room around the branch arrow (`586f01b`)
- **theme:** keep word-diff chips readable on light schemes (`ae6f65c`)
- **ui:** clamp fixed select menu into the viewport (`20bafdb`)
- **review:** converge the jump-to-thread scroll under content-visibility (`164d47b`)
- **layout:** drop the empty discussion host so it adds no leading gap (`51b2227`)
- **review:** split comment fills its pane; diff continues on the other side (`da4a38f`)
- **review:** stop the reply form stretching the Resolve button beside it (`746c7b1`)
- **suggestion:** reconstruct the full range for GitHub multi-line suggestions (`a9bd641`)
- **scroll:** converge reload restore against content-visibility reflow (`9f3e55a`)
- **suggestion:** GitHub-native fence syntax + word-diff the changed tokens (`af3a516`)
- **suggestion:** kill inflated rows in split view too (`f5e7f7d`)
- **diff:** detect plain add/delete from hunk headers; unit tests + green make test (`d4f9d3d`)
- **suggestion:** syntax-highlight the widget and tighten row height (`09785a7`)
- **layout:** square the pinned header's corners; drop the splitter line (`0c27a99`)
- **perf:** give each file a real content-visibility height estimate (`ca9c087`)
- **layout:** drive sticky offsets off the measured bar height (`d705d35`)
- **layout:** realign sticky offsets after the shorter bar (`af74471`)
- **sidebar:** stop the tree's details indent from padding the filter funnel (`d3c5dba`)
- **scroll:** persist active file in chrome.storage.local so reload restore works (`37a7072`)
- restore the file position on reload and detect plain-diff add/delete (`f825103`)
- **diff:** mark rename only on explicit rename from/to, not differing ---/+++ paths (`6dda949`)
- **sidebar:** drop legacy commits-picker margin that doubled the gap before unresolved (`642cd07`)
- **sidebar:** pack review controls right after the toggle, push only the view switch right (`5997fe5`)
- **sidebar:** pin tree toggle far-left on every page, even the uniform bar gap and drop double-gaps from empty status slots (`0d0b17b`)
- **sidebar:** file-diff icon for modified files, drop stray folder icon on the filter button, place collapse toggle left of the commits picker (`20bca96`)
- **sidebar:** use a blue accent for the active-file marker, not the text colour (`e983e5c`)
- keep the header one line on pure renames (stats no longer wrap) (`4214bc1`)
- highlight exactly what a rename changed in the tooltip (`1b8dd90`)
- rich file-header tooltip that highlights what a rename changed (`e9086a3`)
- left-truncate the file path and add an instant hover tooltip (`c0eee74`)
- keep the file header on one line (`b5f0716`)
- name renamed and binary files in the diff (`1d267d4`)
- make diff interactions keyboard-accessible (`4dd7808`)

### ⚡ Performance

- skip off-screen files on resize via content-visibility with pinned heights (`a864550`)
- **startup:** paint the UI before storage reads resolve (`ff4b9c2`)
- lazy-mount file tables, batch and coalesce highlighting (`07d7db8`)
- paint the diff before chrome and network work (`f91a9bb`)

### ♻️ Refactoring

- render the whole diff eagerly, drop lazy mount and content-visibility (`9327372`)
- **review:** drop dead toolbar branch, reuse esc/refreshThreads/md helpers (`7549b6c`)
- **ui:** share surround/prefixLines textarea helpers (`bbb536a`)
- **background:** reuse pushNode for per-line capture splitting (`5a8f907`)
- move dropdown helpers to ui and drop them from PtView (`9c71cb5`)
- **content:** extract theming into theme module (`de6e92a`)
- **content:** extract font-face injection into fonts module (`15a7e19`)
- **providers:** split into gitlab/github/shared modules (`2a93942`)
- **review:** reuse rowFor selector in line-click handler (`c03c597`)
- **a11y:** share Escape-to-close listener across dialogs (`00691d3`)
- **icons:** move edit/trash SVGs into the shared icons registry (`83e15f1`)
- **diff:** share the expand-button fallback between unified and split (`0b33d27`)
- dedupe dialog mounting and menu separator in content (`ca35cd9`)
- extract flashCenter into shared ui module (`e73a8e8`)
- **settings:** remove wrap long lines toggle (`f7b345c`)
- **layout:** split file into self-bordered header + body so the sticky header keeps its rounded top (`9c0625c`)
- drop the last window globals (ptIcons, ptCustomThemes) (`651d975`)
- merge content, providers and review into one bundle (`5ebf494`)
- move content and review into src as TypeScript (`83fd0cc`)
- port the theme gallery and tokens overlays to Solid (`ebf9d5b`)
- render review threads reactively from a store (`4ba7c30`)
- render the comment form as a solid island (`9ef134d`)
- render the gear settings form as a solid island (`3c77fb4`)
- render the toolbar view toggle + progress as a solid island (`6fd4be6`)
- render the diff table as a solid island (`e6bdee5`)
- render the diff file header as a solid island (`3b55354`)
- render the file tree as a solid island (`0f28c4d`)
- bundle content.js, import diff logic from src/diff.ts (`d1f750e`)
- extract pure diff logic into src/diff.ts (`013b681`)
- rewrite the options page in solid (pipeline pilot) (`86bdcae`)
- port providers to typescript with a typed contract (`7c63242`)

### 📖 Documentation

- refresh screenshots with the extended showcase PR (`c1a8e37`)
- regenerate screenshots at a uniform scale, add toolbar shot (`3719eb9`)
- move screenshots out of feature sections into a gallery (`9461be3`)
- set a within-limit AMO add-on name (`86eac32`)
- format AMO listing in AMO-supported Markdown (`37ded6f`)
- add AMO (Firefox Add-ons) store listing copy (`465408e`)
- add CONTRIBUTING, architecture and user guides (`b1a64c5`)

### ✅ Tests

- **e2e:** wait for fonts before opening selects so CI doesn't hit stale menu coords (`c619a66`)
- **e2e:** cover added-image preview and failed comment error path (`5a9fecb`)
- **e2e:** cover custom theme yaml, custom font input and splitter resize (`b8d8456`)
- **e2e:** cover GitLab commit selector and ignore-whitespace toggle (`4ff8a09`)
- **e2e:** cover preamble, generated-file badge and deleted-file filter (`6c6d303`)
- **e2e:** cover hiding viewed files via the funnel filter (`261b476`)
- **e2e:** cover PR metadata, permalinks, read-only mode and non-diff pages (`d435da4`)
- **e2e:** cover GitLab draft review flow (add/discard/publish) (`b9156ef`)
- **e2e:** cover general discussion reply and unresolved-thread navigation (`4fe8486`)
- **e2e:** cover applying and dismissing a suggestion (`5a24edc`)
- **e2e:** cover approve/request-changes/comment review actions (`08b42fe`)
- **e2e:** cover comment form toolbar, preview tab and cancel (`d8b4ad1`)
- **e2e:** cover full-file view, header fold, raw view, clear viewed, tree jumps (`b81d7f7`)
- **e2e:** cover keyboard shortcuts and outside-click dropdown dismissal (`fd77f1b`)
- **sidebar:** lock the tree toggle to the far-left of the bar (`47d25d3`)
- net note edit and delete before the reactive-threads port (`a2c61b8`)
- net thread reply and resolve interactions (`695f41d`)
- cover the comment-creation write path (`0716ffc`)
- run e2e with a seeded token on the authenticated provider path (`d672036`)
- cover all provider methods (mocked token) plus split, word-diff and settings (`147e4b3`)
- cover the gitlab adapter e2e as well (`fc09091`)
- add playwright e2e regression net with a mocked adapter (`01417b9`)

### 💅 Style

- **toolbar:** right-align the diff summary, move branch after unresolved with padding (`6fef06e`)
- match the inter-file gap to the toolbar gap (4px) (`c09fe1d`)
- use a flex gap for file spacing so it doesn't double under containment (`b670806`)
- tighten the gap between file blocks to match the toolbar (`1bb162b`)
- **review:** drop the full-width fill behind comments (transparent row) (`cdcc707`)
- **diff:** always-visible rail scrollbar for split-nowrap panes (`111481b`)
- color tree file names by +/- palette; fix inflated suggestion rows (`8719684`)
- **layout:** let the file header own its top border instead of a bar line (`6cbb0cb`)
- **bar:** add a bottom separator so stuck file headers keep a top edge (`092e7b4`)
- **bar:** tighten bar/filter gaps to 4px and pad progress/CI labels (`1c350fe`)
- **layout:** align the first file's title with the top of the tree (`ee2cf3e`)
- **layout:** tighten the tree/diff gap to match the 8px used elsewhere (`b308ade`)
- **tree:** drop the tree's right padding (`8fb27c5`)
- **bar:** reduce the bar's bottom padding (10px → 4px) (`c6cf4d2`)

### 🔧 Chores

- sync package-lock version and license (`e726e79`)
- **scripts:** add screenshot generator for the docs gallery (`0f0c8df`)
- declare Apache-2.0 license in package.json (`293b72f`)
- **release:** v1.1.0 (`a92b828`)
- remove dead PtView fields and stale comment (`d7fb994`)
- write release archives into build/ instead of the repo root (`7f6df39`)
- move assets under assets/, drop options page, background→src (`b4c5baf`)
- close overlays with Escape and quiet backdrop a11y (`d544b88`)
- silence biome self-findings in the lint tooling (`a7e4a0d`)
- add biome linting, license-header check, pre-commit hook, and CI (`72d25b7`)
- relicense from MIT to Apache License 2.0 (`0eb849a`)
- use the full MIT license text as the per-file header (`19e522e`)
- add esbuild + typescript build toolchain, bundle into dist/ (`05f6616`)

## v1.0.0

### 🚀 Features

- store tokens in storage.local instead of sync (`d9aa3e2`)
- accept fine-grained GitHub tokens, tighten comment markdown spacing (`85600a7`)
- in-page access tokens dialog (`e4ffc8a`)
- dedicated GitHub token form in options (`77ce6c6`)
- flash the thread on n/p navigation (`918d230`)
- tree comment badge jumps to the file's first thread (`0f7e56f`)
- theme gallery, tree comment badges, suggestion dismiss, build hardening (`277b0de`)
- Firefox support groundwork and a GitHub star menu item (`868e976`)
- highlighting for c++, java, ruby, php, c#, lua, toml, hcl (`fe5ca4b`)
- bundled Iosevka Nerd Font Mono and a ligatures toggle (`7546a56`)
- custom base16 themes from tinted-theming yaml, editor preview styles (`226b8e5`)
- unresolved threads dropdown and centered thread navigation (`76fc227`)
- review workflow batch (`f98bd3e`)
- word-level diff highlighting in changed line pairs (`0164ecf`)
- bundled Nerd Font Mono faces, thread replies, full-file polish (`cf91b52`)
- comment editing, deletion and rendered previews with suggestions (`346e3cb`)
- expand hidden lines between hunks and Full file toggle (`5c0f152`)
- side-anchored threads and multiline comments (`2131fe5`)
- bundled web fonts, UI font size and roomier spacing (`2d01787`)
- code font size and italic comments toggle in settings (`c82c0cd`)
- settings dropdown — base16 themes, fonts, tab width, clear viewed (`d5f11ce`)
- markdown toolbar for comment editors (`1e0d03b`)
- custom dropdowns for commits and settings, icon view toggle (`b1e359b`)
- full-height draggable splitter for the tree (`a1652ab`)
- resizable tree and merged single-child directory chains (`fe9331a`)
- extension icon and file tree icons (`112beec`)
- per-file fold and persistent viewed state (`35d1ccf`)
- show and toggle current approval status (`c797eca`)
- GitLab-style toolbar, commit filter, review panel, tree filter (`928c0ea`)
- file tree, side-by-side view and in-page settings button (`1272ae8`)
- GitLab integration — inline comments, approve, request changes (`bfa9185`)
- render raw .diff/.patch pages with tree-sitter highlighting (`4581a08`)

### 🐛 Fixes

- drop pre-wrap on note body so inter-tag newlines don't show as blank lines (`b3620f5`)
- strip blank paragraphs from rendered comment markdown (`4d87f2e`)
- bypass HTTP cache when reloading threads (`1672851`)
- reload threads after note mutations (`467d64a`)
- replies insert above thread actions, not into the button row (`bb76c3d`)
- reply form placement in threads, bigger theme previews (`b638b7c`)
- lazy-render the theme gallery grid (`cdd0d87`)
- CI badge insertion crash, JetBrains Mono and 14px defaults (`ef6ad52`)
- valid position for deletion-side comments, octicons across the UI (`9a5e28d`)
- apply custom font while typing with debounce (`985ca99`)
- drop redundant hunk header after full gap expansion, font picker rework (`afb1f45`)
- font pickers as selects listing only available fonts (`0a7f137`)
- sticky file header offset inside overflow container (`17fa014`)
- remove inline comment row on cancel/submit, keep grid intact (`32ab1ae`)
- table column widths and GitLab project path detection (`5ed4c7d`)

### ♻️ Refactoring

- provider interface with GitLab and GitHub implementations (`009b8da`)

### 📖 Documentation

- refresh thread screenshot with tightened comment spacing (`7932bed`)
- use full-resolution screenshots across the README (`7b9aa1d`)
- refresh screenshots on the public GitHub PR #130 (`0bebaa6`)
- refresh thread screenshot with the Dismiss action (`d6841df`)
- use real screenshots, move whitespace toggle into settings block (`a7f3e9a`)
- detailed README with screenshots, MIT license (`5f3adb0`)
- add README with install and vendoring notes (`945229f`)

### 👷 Build & CI

- Makefile with pinned asset fetching, CI releases, untracked binaries (`aaf196c`)

- reference AMO secret through job env in step condition (`592a9bb`)

### 💅 Style

- consistent base styling for dialog action buttons (`8666b6a`)
- outline view-toggle icons sized to the toolbar (`754f07e`)
- octicon edit/delete note actions with armed delete state (`8ef66b4`)
- bounded comment form card instead of full-width band (`c77bc33`)
- GitHub-like comment form actions (`b4447c1`)
- slightly tighter tree spacing (`271be12`)
- roomier file tree (`8a8f4cb`)

### 🔧 Chores

- bump version to 1.0.0 (`1fb9098`)

