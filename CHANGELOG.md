# Changelog

All notable changes, grouped from [conventional commits](https://www.conventionalcommits.org).

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

