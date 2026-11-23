# Privacy policy

patchtree is a diff viewer that runs entirely in your browser. It has no
backend: there is no patchtree server, no account, no analytics and no
telemetry. Nothing about you or your code is sent to the author of this
extension or to any third party.

## What the extension stores

Everything is kept by the browser on your own machine:

| Data | Where | Why |
|---|---|---|
| OAuth credentials and access tokens for GitLab / GitHub | `chrome.storage.local` (local only, never synced) | to read diffs and post your review actions on your behalf |
| Appearance settings — theme, fonts, sizes, tab width, inline/side-by-side, file tree width | `chrome.storage.sync` | to keep the viewer looking the way you set it |
| Code navigation indexes for commits whose symbols you inspect | Extension Cache Storage (local only, reused for 30 days) | to reuse definition and reference lookups after reload |
| Up to four repository source snapshots used for indexing | Extension Cache Storage (local only, reused for one day) | to share the download between indexers |
| Review progress — which files you marked viewed, your last position in a diff | `chrome.storage.local` | so a reload picks up where you left off |

You can clear all of it at any time by removing the extension, or wipe tokens
from the ⚙ menu → **Access tokens**. Use **Sign in with OAuth… → Disconnect**
to remove the local OAuth session for a host.

## Where data goes

Requests are made only to the host of the diff page you are looking at and that
host's own API — for example `gitlab.example.com` and its `/api/v4`, or
GitHub's `github.com`, `api.github.com` and `codeload.github.com`. They are used
to:

- exchange OAuth codes and refresh OAuth credentials when you use OAuth;
- fetch file contents when you expand hidden lines or open a full file;
- download a repository snapshot on the first symbol click in a supported diff
  or when you select a language under **Code index**. The bundled indexer
  processes it in your browser;
- render markdown through the platform's own markdown endpoint;
- read discussions, and post the comments, suggestions, resolutions and reviews
  you submit.

Your access token is sent only to the host it was entered for. No other network
destination is ever contacted: no CDN, no analytics endpoint, no third-party
service. All code, WebAssembly grammars, fonts and theme data ship inside the
extension package — nothing is downloaded and executed at runtime.

## What is never collected

No browsing history, no page content outside the review you opened, no
personal details, no usage statistics, no crash reports. The extension cannot see tabs
other than the diff page it renders (and, when you click its toolbar icon, the
URL of that tab in order to open the corresponding `.diff`).

## Source and contact

patchtree is open source under the Apache License 2.0:
<https://github.com/danilrwx/patchtree>. Questions and reports go to the
[issue tracker](https://github.com/danilrwx/patchtree/issues).
