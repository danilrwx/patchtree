// Copyright 2026 Daniil Antoshin
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"cmp"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"io/fs"
	"path"
	"slices"
	"strings"
	"unicode/utf8"

	"golang.org/x/mod/modfile"
)

type goSnapshot struct {
	Version    int               `json:"version"`
	Repository string            `json:"repository"`
	Revision   string            `json:"revision"`
	GOOS       string            `json:"goos"`
	GOARCH     string            `json:"goarch"`
	Tags       []string          `json:"tags,omitempty"`
	Sources    map[string]string `json:"sources"`
}

type goIndexer struct {
	context      build.Context
	snapshot     map[string]string
	lines        map[string][]string
	versions     map[string]string
	fset         *token.FileSet
	packages     map[string][]*ast.File
	tests        map[string][]*ast.File
	checked      map[string]*types.Package
	checking     map[string]bool
	result       navigation
	sizes        types.Sizes
	stream       *goIndexStream
	sourceHashes map[string]goSourceHashes
	cacheKeys    map[string]string
	cacheHits    map[string]goCacheHit
	emitError    error
}

func snapshotModules(sources map[string]string) (map[string]*modfile.File, error) {
	dirs := []string{"."}
	if text, ok := sources["go.work"]; ok {
		workspace, err := modfile.ParseWork("go.work", []byte(text), nil)
		if err != nil {
			return nil, err
		}
		dirs = nil
		for _, use := range workspace.Use {
			if dir := path.Clean(use.Path); fs.ValidPath(dir) {
				dirs = append(dirs, dir)
			}
		}
	}
	modules := make(map[string]*modfile.File)
	for _, dir := range dirs {
		name := path.Join(dir, "go.mod")
		text, ok := sources[name]
		if !ok {
			continue
		}
		mod, err := modfile.ParseLax(name, []byte(text), nil)
		if err != nil {
			return nil, err
		}
		if mod.Module != nil {
			modules[dir] = mod
		}
	}
	if len(modules) == 0 {
		return nil, fmt.Errorf("no Go modules found in go.work or root go.mod")
	}
	return modules, nil
}

func indexGoJSON(reader io.Reader) (navigation, error) {
	var snapshot goSnapshot
	if err := json.NewDecoder(reader).Decode(&snapshot); err != nil {
		return navigation{}, err
	}
	return indexGo(snapshot)
}

func indexGo(snapshot goSnapshot) (navigation, error) {
	return buildGoIndex(snapshot, nil)
}

func buildGoIndex(snapshot goSnapshot, stream *goIndexStream) (navigation, error) {
	if snapshot.Version != 1 {
		return navigation{}, fmt.Errorf("unsupported source snapshot version %d", snapshot.Version)
	}
	if snapshot.Repository == "" || snapshot.Revision == "" || snapshot.GOOS == "" || snapshot.GOARCH == "" {
		return navigation{}, fmt.Errorf("repository, revision, goos and goarch are required")
	}
	sizes := types.SizesFor("gc", snapshot.GOARCH)
	if sizes == nil {
		return navigation{}, fmt.Errorf("unsupported Go architecture %q", snapshot.GOARCH)
	}
	modules, err := snapshotModules(snapshot.Sources)
	if err != nil {
		return navigation{}, err
	}
	idx := &goIndexer{
		context: build.Default, snapshot: snapshot.Sources, versions: map[string]string{},
		fset: token.NewFileSet(), packages: map[string][]*ast.File{},
		tests: map[string][]*ast.File{},
		lines: map[string][]string{}, sizes: sizes,
		checked: map[string]*types.Package{}, checking: map[string]bool{},
		result: navigation{Version: 1, Repository: snapshot.Repository, Revision: snapshot.Revision,
			Files: make(map[string]map[int]*sourceLine)},
		stream: stream,
	}
	if stream != nil && stream.load != nil {
		idx.sourceHashes = make(map[string]goSourceHashes)
	}
	idx.context.GOOS, idx.context.GOARCH = snapshot.GOOS, snapshot.GOARCH
	idx.context.BuildTags = snapshot.Tags
	idx.context.ToolTags = nil
	idx.context.CgoEnabled = false
	idx.context.JoinPath = path.Join
	idx.context.OpenFile = func(name string) (io.ReadCloser, error) {
		text, ok := idx.snapshot[name]
		if !ok {
			return nil, fs.ErrNotExist
		}
		return io.NopCloser(strings.NewReader(text)), nil
	}

	paths := make([]string, 0, len(snapshot.Sources))
	for name := range snapshot.Sources {
		if !fs.ValidPath(name) || strings.Contains(name, "\\") {
			return navigation{}, fmt.Errorf("invalid snapshot path %q", name)
		}
		paths = append(paths, name)
	}
	slices.Sort(paths)
	for _, name := range paths {
		idx.addFile(name, modules)
	}
	if stream != nil {
		idx.snapshot = nil
	}
	if len(idx.packages) == 0 && len(idx.tests) == 0 {
		return navigation{}, fmt.Errorf("no Go packages for %s/%s", snapshot.GOOS, snapshot.GOARCH)
	}
	// Checking all packages keeps results independent of the caller's entry file.
	packages := make([]string, 0, len(idx.packages))
	for name := range idx.packages {
		packages = append(packages, name)
	}
	slices.Sort(packages)
	tests := make([]string, 0, len(idx.tests))
	for name := range idx.tests {
		tests = append(tests, name)
	}
	slices.Sort(tests)
	if stream != nil {
		if err := idx.prepareReuse(snapshot, packages, tests); err != nil {
			return navigation{}, err
		}
	}
	for _, name := range packages {
		if !idx.reuse("p:" + name).found {
			_, _ = idx.Import(name)
		}
		if idx.emitError != nil {
			return navigation{}, idx.emitError
		}
		if stream != nil && idx.checked[name] != nil && len(idx.tests[name]) == 0 {
			delete(idx.packages, name)
		}
	}
	for _, name := range tests {
		plan := idx.testPlan(name)
		internalID, externalID := "i:"+name, "e:"+name
		var externalHit goCacheHit
		if len(plan.external) > 0 {
			externalHit = idx.reuse(externalID)
		}
		var testPackage *types.Package
		if len(plan.internal) > 0 {
			hit := idx.reuse(internalID)
			if !hit.found || (len(plan.external) > 0 && !externalHit.found) {
				files := append(slices.Clone(idx.packages[name]), plan.internal...)
				testPackage, _ = idx.check(internalID, name, idx.versions[name], files, idx, true, hit)
			}
		}
		if len(plan.external) > 0 && !externalHit.found {
			importer := packageImporter(func(path string) (*types.Package, error) {
				if path == name && testPackage != nil {
					return testPackage, nil
				}
				return idx.Import(path)
			})
			_, _ = idx.check(externalID, name+"_test", idx.versions[name], plan.external, importer, true, externalHit)
		}
		if idx.emitError != nil {
			return navigation{}, idx.emitError
		}
		if stream != nil {
			// Reused production packages can still be imported by a later test.
			if idx.checked[name] != nil {
				delete(idx.packages, name)
			}
			delete(idx.tests, name)
		}
	}
	sortGoRows(idx.result.Files)
	slices.Sort(idx.result.Diagnostics)
	idx.result.Diagnostics = slices.Compact(idx.result.Diagnostics)
	return idx.result, nil
}

func sortGoRows(files map[string]map[int]*sourceLine) {
	for _, rows := range files {
		for _, row := range rows {
			slices.SortFunc(row.Spans, func(a, b span) int { return cmp.Compare(a.Start, b.Start) })
		}
	}
}

func (idx *goIndexer) addFile(name string, modules map[string]*modfile.File) {
	dir, base := path.Split(name)
	if !strings.HasSuffix(base, ".go") {
		return
	}
	var root string
	for d := path.Dir(name); ; d = path.Dir(d) {
		part := path.Base(d)
		if d != "." && (part == "vendor" || part == "testdata" || strings.HasPrefix(part, ".") || strings.HasPrefix(part, "_")) {
			return
		}
		if _, candidate := idx.snapshot[path.Join(d, "go.mod")]; candidate && root == "" {
			root = d
		}
		if d == "." {
			break
		}
	}
	mod := modules[root]
	if mod == nil {
		return
	}
	match, err := idx.context.MatchFile(dir, base)
	if err != nil {
		idx.result.Diagnostics = append(idx.result.Diagnostics, fmt.Sprintf("%s: %v", name, err))
	}
	if !match || err != nil {
		return
	}
	text := idx.snapshot[name]
	if !utf8.ValidString(text) {
		idx.result.Diagnostics = append(idx.result.Diagnostics, name+": source is not UTF-8")
		return
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	file, err := parser.ParseFile(idx.fset, name, text, parser.SkipObjectResolution)
	if err != nil {
		idx.result.Diagnostics = append(idx.result.Diagnostics, err.Error())
		return
	}
	for _, imp := range file.Imports {
		if imp.Path.Value == `"C"` || imp.Path.Value == "`C`" {
			idx.result.Diagnostics = append(idx.result.Diagnostics, name+": cgo source excluded")
			return
		}
	}
	idx.lines[name] = strings.Split(text, "\n")
	if idx.sourceHashes != nil {
		idx.sourceHashes[name] = fingerprintGoSource(idx.fset, file, text)
	}
	relative := dir
	if root != "." {
		relative = strings.TrimPrefix(dir, root+"/")
	}
	pkg := path.Join(mod.Module.Mod.Path, relative)
	if mod.Go != nil {
		idx.versions[pkg] = "go" + mod.Go.Version
	}
	if strings.HasSuffix(base, "_test.go") {
		idx.tests[pkg] = append(idx.tests[pkg], file)
		return
	}
	idx.packages[pkg] = append(idx.packages[pkg], file)
}

type packageImporter func(string) (*types.Package, error)

func (importer packageImporter) Import(name string) (*types.Package, error) {
	return importer(name)
}

func (idx *goIndexer) Import(name string) (*types.Package, error) {
	if name == "unsafe" {
		return types.Unsafe, nil
	}
	if idx.checking[name] {
		return nil, fmt.Errorf("import cycle involving %s", name)
	}
	if pkg := idx.checked[name]; pkg != nil {
		return pkg, nil
	}
	files := idx.packages[name]
	if len(files) == 0 {
		return nil, fmt.Errorf("package %s is outside the indexed module", name)
	}
	idx.checking[name] = true
	defer delete(idx.checking, name)
	pkg, err := idx.check("p:"+name, name, idx.versions[name], files, idx, false, idx.reuse("p:"+name))
	if pkg != nil {
		// A partial package still contains definitions for references already resolved.
		idx.checked[name] = pkg
		return pkg, nil
	}
	return nil, err
}

func (idx *goIndexer) check(id, name, goVersion string, files []*ast.File, importer types.Importer, testsOnly bool, hit goCacheHit) (*types.Package, error) {
	var info *types.Info
	if !hit.found {
		info = &types.Info{Uses: map[*ast.Ident]types.Object{}, Defs: map[*ast.Ident]types.Object{}}
	}
	var diagnostics []string
	cfg := types.Config{
		Importer: importer, GoVersion: goVersion, Sizes: idx.sizes,
		IgnoreFuncBodies: hit.found && hit.clean,
		Error: func(err error) {
			if !hit.found {
				diagnostics = append(diagnostics, err.Error())
			}
		},
	}
	pkg, err := cfg.Check(name, idx.fset, files, info)
	if idx.emitError != nil {
		return pkg, idx.emitError
	}
	if hit.found {
		return pkg, err
	}
	idx.result.Diagnostics = append(idx.result.Diagnostics, diagnostics...)
	for ident, obj := range info.Defs {
		// An embedded type token also defines the field. Its jump should
		// follow the type use when it resolves.
		if field, ok := obj.(*types.Var); ok && field.Embedded() {
			continue
		}
		idx.addOccurrence(ident, obj, testsOnly)
	}
	for ident, obj := range info.Uses {
		idx.addOccurrence(ident, obj, testsOnly)
	}
	if idx.stream != nil && (len(idx.result.Files) > 0 || idx.cacheKeys[id] != "") {
		sortGoRows(idx.result.Files)
		idx.emitError = idx.stream.emit(id, idx.cacheKeys[id], idx.result.Files, diagnostics)
		for path := range idx.result.Files {
			delete(idx.lines, path)
		}
		idx.result.Files = make(map[string]map[int]*sourceLine)
	}
	return pkg, err
}

func (idx *goIndexer) addOccurrence(ident *ast.Ident, obj types.Object, testsOnly bool) {
	if obj == nil || !obj.Pos().IsValid() {
		return
	}
	if _, ok := obj.(*types.PkgName); ok {
		return
	}
	// Use physical coordinates even in generated files with //line directives.
	start := idx.fset.PositionFor(ident.Pos(), false)
	if testsOnly && !strings.HasSuffix(start.Filename, "_test.go") {
		return
	}
	target := idx.fset.PositionFor(obj.Pos(), false)
	if !start.IsValid() || !target.IsValid() {
		return
	}
	if idx.stream == nil {
		idx.row(target)
	}
	row := idx.row(start)
	row.Spans = append(row.Spans, span{
		Start:   start.Column - 1,
		End:     start.Column - 1 + len(ident.Name),
		Targets: []location{{Path: target.Filename, Line: target.Line, Column: target.Column - 1}},
	})
}

func (idx *goIndexer) row(pos token.Position) *sourceLine {
	rows := idx.result.Files[pos.Filename]
	if rows == nil {
		rows = make(map[int]*sourceLine)
		idx.result.Files[pos.Filename] = rows
	}
	if rows[pos.Line] == nil {
		rows[pos.Line] = &sourceLine{Text: idx.lines[pos.Filename][pos.Line-1], Spans: []span{}}
	}
	return rows[pos.Line]
}
