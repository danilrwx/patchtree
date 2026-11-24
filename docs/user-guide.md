# User guide

patchtree turns a raw `.diff` / `.patch` page into a full code-review UI. This
guide walks through using it; for installation see the
[README](../README.md#install).

## Opening a diff

patchtree activates on any plain-text `.diff` / `.patch` page:

- **GitLab** — a merge request's diff, e.g.
  `https://gitlab.example.com/group/project/-/merge_requests/104.diff`
  (works on any instance, including self-hosted).
- **GitHub** — a pull request's diff,
  `https://github.com/owner/repo/pull/123.diff`.
- **Local files** — a `.diff` / `.patch` opened via `file://`. Enable
  **Allow access to file URLs** in the extension's details page first. Local
  patches render read-only (there's no host to review against).

On an MR/PR page you can also click the toolbar icon to jump to its `.diff`.

![overview](screenshots/overview.png)

## Reading the diff

- **File tree** (left) — filter by name *or* diff content, jump to a file,
  see per-file `+N −M` and a comment-count badge. Drag the divider to resize.
- **Inline / side-by-side** — toggle in the toolbar; fully added or deleted
  files span the full width in split mode.
- **Word-level diff** — changed words inside a modified line pair get a
  stronger tint under the syntax colors.
- **Expand hidden lines** — click the gap between hunks to fetch and show the
  lines in between, or use **Full file** in a file's header.
- **Viewed** — tick a file as reviewed; the toolbar shows an `N/M viewed`
  counter and viewed files auto-collapse. Generated files (lock files,
  `*.pb.go`, `vendor/`, minified) start collapsed.

### Keyboard

| Key | Action |
|---|---|
| `j` / `k` | next / previous file |
| `n` / `p` | next / previous thread (centered) |
| `v` | toggle *viewed* on the current file |
| `x` | fold / unfold the current file |
| `/` | focus the file filter |

Alt-click a line number copies a permalink to that line.

## Reviewing

Review actions need an access token (see [Tokens](#tokens)); without one the
diff is read-only.

- **Comment on a line** — click a line number to open the form. Write in
  Markdown (toolbar + Write/Preview tabs).
- **Multi-line comment** — shift-click another line number to extend the range.

  ![multiline comment](screenshots/multiline.png)
- **Suggestions** — the toolbar's suggestion button inserts a `suggestion`
  block prefilled with the line; an incoming suggestion renders as a red/green
  widget with **Apply** (GitLab) or **Dismiss**.

  ![thread with a suggestion](screenshots/thread.png)
- **Reply / resolve** — reply under a thread, resolve/unresolve it; the
  **unresolved** dropdown in the toolbar jumps to each open thread.
- **Edit / delete** your own comments inline.
- **Draft reviews** (GitLab) — “Add to review” collects pending comments;
  **Submit review** publishes them with a summary and Comment / Approve /
  Request changes.

  ![submit review](screenshots/submit-review.png)

General (non-line) discussion renders above the first file. The toolbar also
shows pipeline/checks status and a merge-conflict indicator, and a **commit
filter** to view a single commit's diff.

## Appearance

Open the ⚙ gear menu to change the theme, fonts and layout.

![settings](screenshots/settings.png)

- **Theme gallery** — search a large gallery of color schemes with live
  previews (including how added/removed lines will look) and a light/dark
  filter, or paste your own scheme YAML.

  ![theme gallery](screenshots/theme-gallery.png)
- **Fonts** — bundled UI/code fonts (JetBrains Mono, Inter, several Nerd Font
  builds) or any local font by name; separate UI/code sizes.
- **Layout** — tab width, italic comments, ligatures.

## Tokens

### OAuth sign-in

On a GitHub or GitLab review diff, choose **⚙ → Sign in with OAuth…**. For
GitHub, open the verification page, enter the displayed device code and
approve the application. For GitLab, approve access in the browser sign-in
window. The gear menu shows the connected service. Reload the diff to enable
review controls. Patchtree uses the GitHub OAuth session for API requests
including diffs, repository files and review actions. Sessions with refresh
tokens renew automatically when a request needs a new access token.

A release can include the public client ID for GitHub and GitLab.com. When a
client ID has not been configured, register an application once and enter
its **client ID** in the sign-in page:

- **GitHub** — [register an OAuth App](https://github.com/settings/applications/new)
  named **Patchtree**. Use `https://github.com/danilrwx/patchtree` for the
  homepage and callback fields. Enable **Device Flow**. Patchtree requests the
  `repo` scope for repository and review access. The public client ID is enough
  to authorize a device and refresh an expiring token.
- **GitLab** — register a public application on your instance under
  **Applications**. Clear **Confidential**, enable the `api` scope, and
  register the redirect URL shown on the Patchtree sign-in page for each
  browser you use.

### Personal access tokens

⚙ → **Access tokens** stores per-host credentials locally (never synced), used
only against their own host:

- **GitLab** — a personal access token with the `api` scope, per instance.
- **GitHub** — a classic token (`repo` scope) or a fine-grained token with
  *Pull requests: read & write*.

Changes take effect after reloading the diff page.

![access tokens](screenshots/tokens.png)
