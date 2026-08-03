# Privacy policy

patchtree is a diff viewer that runs entirely in your browser. It has no
backend: there is no patchtree server, no account, no analytics and no
telemetry. Nothing about you or your code is sent to the author of this
extension or to any third party.

## What the extension stores

Everything is kept by the browser on your own machine:

| Data | Where | Why |
|---|---|---|
| Access tokens you enter for GitLab / GitHub | `chrome.storage.local` (local only, never synced) | to read diffs and post your review actions on your behalf |
| Appearance settings — theme, fonts, sizes, tab width, inline/side-by-side, file tree width | `chrome.storage.sync` | to keep the viewer looking the way you set it |
| Review progress — which files you marked viewed, your last position in a diff | `chrome.storage.local` | so a reload picks up where you left off |

You can clear all of it at any time by removing the extension, or wipe tokens
from the ⚙ menu → **Access tokens**.

## Where data goes

Requests are made only to the host of the diff page you are looking at and that
host's own API — for example `gitlab.example.com` and its `/api/v4`, or
`github.com` and `api.github.com`. They are used to:

- fetch file contents when you expand hidden lines or open a full file;
- render markdown through the platform's own markdown endpoint;
- read discussions, and post the comments, suggestions, resolutions and reviews
  you submit.

Your access token is sent only to the host it was entered for. No other network
destination is ever contacted: no CDN, no analytics endpoint, no third-party
service. All code, WebAssembly grammars, fonts and theme data ship inside the
extension package — nothing is downloaded and executed at runtime.

## What is never collected

No browsing history, no page content outside the diff you opened, no personal
details, no usage statistics, no crash reports. The extension cannot see tabs
other than the diff page it renders (and, when you click its toolbar icon, the
URL of that tab in order to open the corresponding `.diff`).

## Source and contact

patchtree is open source under the Apache License 2.0:
<https://github.com/danilrwx/patchtree>. Questions and reports go to the
[issue tracker](https://github.com/danilrwx/patchtree/issues).
