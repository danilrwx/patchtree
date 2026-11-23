# Patchtree code navigation

Patchtree uses a revision-pinned JSON map. It includes repository-relative
paths, 1-based lines and 0-based UTF-8 byte offsets. Patchtree matches each
indexed source line before looking up its token and preserves multiple
possible targets. The command in this directory exports the same map that the
extension reads.

## Native binary

Build from this directory with Go 1.26 or later.

```sh
mkdir -p "$HOME/.local/bin"
go build -o "$HOME/.local/bin/code-index" .
```

Run from a clean checkout of the commit you want to index. Use the HTTPS URL of
the repository that owns the review.

```sh
code-index -go-source -repo https://github.com/owner/repo > code-index.json
```

Set `-goos`, `-goarch` and `-tags` to select the target build. By default the
native command targets the current OS and architecture. It uses Git to identify
the commit and tracked files. The Go checker is included in the binary.

The same binary can export an existing SCIP index. For C, use the SCIP file
from `scip-clang` or its repaired version from `repair-scip`.

```sh
code-index -repo https://github.com/owner/repo -scip index.scip > code-index.json
```

Repeat `-scip` to merge indexes for the same checkout. SCIP coordinates in
UTF-8, UTF-16, and UTF-32 are converted to UTF-8 byte offsets in the map.
The source files on disk must be UTF-8.

## Embed the same Go indexer

Build the browser artifact from the same source and toolchain as the native
binary. Package both browser files with the extension.

```sh
GOOS=js GOARCH=wasm go build -o code-index.wasm .
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

After starting the module with the Go runtime in a Web Worker, call
`codeIndexGo(JSON.stringify(snapshot))`. It returns the navigation map as a JSON
string or a JSON object with an `error` string. Native tools can send the same
snapshot to `code-index -snapshot` on stdin and read the map from stdout.
Errors from the CLI go to stderr with a nonzero exit status.

A version 1 snapshot carries the exact repository revision and the target build
configuration. Supply source paths relative to the repository root, including
`go.mod`.

```json
{
  "version": 1,
  "repository": "https://github.com/owner/repo",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "goos": "linux",
  "goarch": "amd64",
  "tags": [],
  "sources": {
    "go.mod": "module example.com/repo\n",
    "example.go": "package example\nconst Label = \"example\"\nvar name = Label\n"
  }
}
```

The caller supplies source files from its checkout or repository API. The Go
backend checks the root module or the local modules listed in the root
`go.work`, including Go tests, with cgo disabled.
Unresolved imports, including standard library and external modules, appear in
`diagnostics`. References the checker resolves still appear in `files`.
Patchtree packages the WASM backend. It passes a GitHub or GitLab tar.gz
snapshot to `codeIndexGoArchive`. The browser uses Linux/amd64 with default
build tags and cgo disabled.
Dependency downloads and a versioned dependency cache are pending.

## C/C++ and JavaScript/TypeScript

All three language groups share the same revision-pinned source snapshot.
The TypeScript compiler reads JavaScript, TypeScript, JSX and TSX with the
project's `tsconfig.json` or `jsconfig.json`, including aliases and re-exports.
Dependencies can resolve from the snapshot.

Clang uses `compile_commands.json` entries found in the snapshot. It maps
recorded checkout paths to the snapshot and uses the available project
headers, include paths, preprocessor definitions, language and target flags.
It uses default flags for translation units without a matching command.
Generated files, missing system headers and unsupported flags can limit
coverage. Open **Settings → Code index → Indexing limitations** for details.

## Use the map

- **Patchtree** — open the PR, MR or GitHub commit diff and choose **Settings → Code index →
  Index Go**, **Index C/C++** or **Index JavaScript/TypeScript**. Clicking a
  supported symbol also starts indexing. Patchtree saves a source snapshot for
  one day and the index for 30 days. The index key covers the repository, source
  commit and its project configuration, and the bundled analyzer version.
  **Import…** also accepts a map built by the CLI.
  In **All commits**, click an indexed symbol on the new side. A definition
  in the same file jumps directly to its line, expanding context as needed.
  For another file, choose a path and line in the card to read the file at that
  revision in Patchtree. Click symbols in the file to follow definitions.
  Use the back button or Alt+Left to retrace jumps. Escape returns to the diff.
  Right-click an indexed symbol or press Shift+F12 at the caret to see its
  indexed references, grouped by file. Choose a reference to jump to its line.
  The external-link button opens the pinned line on the hosting site.
  Ctrl-click (Cmd-click on macOS) opens a unique definition there directly.
  A manual import lasts until reload.
- **Vim** — keep `code-index.json` at the repository root. Source
  `vim/code-index.vim` from your vimrc. Use `:CodeIndexDefinition` under the
  cursor and Ctrl+T to return. To bind the command to `gd`, add
  `nmap gd <Plug>(CodeIndexDefinition)` to your vimrc.

Patchtree imports maps up to 64 MiB, builds maps up to 128 MiB and downloads
archives up to 32 MiB compressed. Go accepts up to 128 MiB expanded. The
C/C++ and JavaScript/TypeScript analyzers accept up to 512 MiB expanded. Links
use the review repository, so a fork's head must be accessible there for
links to open.
