# AMO (Firefox Add-ons) store listing

AMO supports a limited Markdown set (bold `**`, italic `_`, links, blockquote,
code ``` ``` ```, `-`/`1.` lists — no headings). The Description below is
written in that dialect and can be pasted as-is.

## Name (≤ 50 chars)
Patchtree — pretty diffs & code review

## Summary (≤ 250 chars)
Turn any raw .diff / .patch page into a full code-review UI: tree-sitter syntax highlighting, a searchable file tree, inline & side-by-side views, and inline review — comments, suggestions, approvals — for GitLab and GitHub.

## Description (AMO Markdown)

patchtree renders plain-text .diff / .patch pages as a fast, full-featured code-review interface — the kind you get on a merge/pull request, but on the raw diff itself, on any host.

Open a diff URL such as `https://gitlab.example.com/group/project/-/merge_requests/104.diff` (or click the toolbar icon on any MR/PR page) and review right there. It also renders local `.diff` / `.patch` files opened via `file://`.

**Diff rendering**

- Any plain-text `.diff` / `.patch` page, whatever served it — git-format or a plain `diff -u`, GitLab, GitHub, or a local file.
- Inline and side-by-side views; fully added or deleted files use the full width in split mode.
- Real syntax highlighting via tree-sitter (WebAssembly, run off the main thread): Go, JS/TS/TSX, Python, Bash, JSON, YAML, Rust, C, C++, Java, Ruby, PHP, C#, Lua, TOML, HCL/Terraform, CSS, HTML, and Helm/Go templates.
- Word-level diff: the exact words that changed get a stronger tint.
- Expand hidden lines between hunks, or a Full-file toggle per file.
- Large diffs stay smooth — only visible file sections are rendered.

**Navigation**

- Resizable, filterable file tree (filter matches paths and diff content), status icons and colors (added / modified / renamed / deleted), per-file `+N −M` and comment-count badges.
- Filter by file extension; hide viewed or deleted files.
- Viewed checkboxes with an N/M progress counter; auto-collapse of generated files (lock files, vendored, minified, `*.pb.go`, …).
- Follows the file you're on and remembers your place across reloads.
- Keyboard: `j`/`k` files, `n`/`p` threads, `v` viewed, `x` fold, `e` toggle tree, `/` focus filter.
- Per-commit diff filter; copy-path, open-at-head, and line permalinks.

**Review** (with an access token)

- Threads anchored to lines (old or new side), replies, edit and delete.
- Markdown editor with a toolbar and Write/Preview tabs, rendered through the platform's own API.
- Suggestions: one click prefills a suggestion block; existing suggestions render as a red/green widget with Apply (GitLab).
- Multiline comments (shift-click a line number to extend the range).
- Resolve / unresolve threads and an "unresolved" jump list (GitLab).
- Draft reviews and a Submit-review panel: Comment / Approve / Request changes, with the approval state shown as a badge.
- Pipeline/checks status and a merge-conflict indicator in the toolbar.

**Appearance**

- Theme gallery with the base24 schemes from tinted-theming, live code previews (including how added/removed lines look), light/dark filter, and paste-your-own scheme YAML.
- Bundled fonts (Nerd Font builds, JetBrains Mono by default), or any local font by name; separate UI/code font sizes, tab width, italic-comment and ligature toggles.

**Setup**

- Firefox MV3 treats host access as opt-in — enable _Access your data for all websites_ (or grant specific hosts) in the add-on's Permissions tab, or the content script won't run.
- To render local files, allow the add-on access to `file://` URLs.
- Rendering needs no account. To turn on review actions, open the ⚙ menu → Access tokens and add a GitLab host (PAT scope `api`) and/or a GitHub token (classic `repo`, or fine-grained with Pull requests read & write).

**Privacy**

patchtree talks only to the diff's own host and its API (GitLab/GitHub) to render diffs and post your review actions. Access tokens are stored locally (`storage.local`) and never synced or sent anywhere else. No analytics, no tracking, no third-party servers.

Open source (Apache-2.0): [github.com/danilrwx/patchtree](https://github.com/danilrwx/patchtree)
