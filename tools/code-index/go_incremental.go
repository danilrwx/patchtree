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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"go/ast"
	"go/token"
	"slices"
	"strconv"
	"strings"
)

type goIndexStream struct {
	prepare func([]string) error
	load    func(id, key string) ([]string, bool, error)
	emit    func(id, key string, files map[string]map[int]*sourceLine, diagnostics []string) error
}

type goAnalysis struct {
	Reused int `json:"reused"`
	Units  int `json:"units"`
}

type goCacheHit struct {
	found bool
	clean bool
}

type goTestPlan struct {
	internal []*ast.File
	external []*ast.File
}

func goDigest(parts []string) string {
	encoded, _ := json.Marshal(parts)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

type goSourceHashes struct {
	full         string
	declarations string
}

func fingerprintGoSource(fset *token.FileSet, file *ast.File, text string) goSourceHashes {
	raw := sha256.Sum256([]byte(text))
	full := hex.EncodeToString(raw[:])
	var parts []string
	from := 0
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		start := fset.PositionFor(fn.Body.Pos(), false)
		end := fset.PositionFor(fn.Body.End(), false)
		// A caller's cached targets use physical line and column, even after a body.
		parts = append(parts, text[from:start.Offset], strconv.Itoa(end.Line), strconv.Itoa(end.Column))
		from = end.Offset
	}
	declarations := full
	if len(parts) > 0 {
		declarations = goDigest(append(parts, text[from:]))
	}
	return goSourceHashes{full: full, declarations: declarations}
}

func goImports(files []*ast.File) []string {
	var imports []string
	for _, file := range files {
		for _, imp := range file.Imports {
			if name, err := strconv.Unquote(imp.Path.Value); err == nil {
				imports = append(imports, name)
			}
		}
	}
	slices.Sort(imports)
	return slices.Compact(imports)
}

func (idx *goIndexer) testPlan(name string) goTestPlan {
	var plan goTestPlan
	production := idx.packages[name]
	for _, file := range idx.tests[name] {
		pkg := file.Name.Name
		if strings.HasSuffix(pkg, "_test") && (len(production) == 0 || pkg != production[0].Name.Name) {
			plan.external = append(plan.external, file)
		} else {
			plan.internal = append(plan.internal, file)
		}
	}
	return plan
}

func (idx *goIndexer) prepareReuse(snapshot goSnapshot, packages, tests []string) error {
	if idx.stream.load == nil {
		return nil
	}
	idx.cacheKeys = make(map[string]string, len(packages)+len(tests))
	idx.cacheHits = make(map[string]goCacheHit)
	config := goDigest(append([]string{snapshot.GOOS, snapshot.GOARCH}, snapshot.Tags...))
	local := func(name string, files []*ast.File, declarationsOnly bool) []string {
		parts := []string{config, name, idx.versions[name]}
		for _, file := range files {
			filename := idx.fset.PositionFor(file.Package, false).Filename
			hash := idx.sourceHashes[filename]
			if declarationsOnly {
				parts = append(parts, filename, hash.declarations)
			} else {
				parts = append(parts, filename, hash.full)
			}
		}
		return parts
	}
	active := make(map[string]bool)
	declarations := make(map[string]string)
	var production func(string) string
	production = func(name string) string {
		if name == "unsafe" || len(idx.packages[name]) == 0 {
			return "external:" + name
		}
		id := "p:" + name
		if key, ok := declarations[name]; ok {
			return key
		}
		if active[name] {
			return ""
		}
		active[name] = true
		defer delete(active, name)
		var dependencies []string
		for _, dep := range goImports(idx.packages[name]) {
			if key := production(dep); key != "" {
				dependencies = append(dependencies, dep, key)
			} else {
				declarations[name] = ""
				return ""
			}
		}
		idx.cacheKeys[id] = goDigest(append(local(name, idx.packages[name], false), dependencies...))
		declarations[name] = goDigest(append(local(name, idx.packages[name], true), dependencies...))
		return declarations[name]
	}
	testKey := func(name string, files []*ast.File, own string) string {
		if own == "" {
			return ""
		}
		parts := append(local(name, files, false), own)
		for _, dep := range goImports(files) {
			if key := production(dep); key != "" {
				parts = append(parts, dep, key)
			} else {
				return ""
			}
		}
		return goDigest(parts)
	}
	ids := make([]string, 0, len(packages)+len(tests))
	for _, name := range packages {
		production(name)
		ids = append(ids, "p:"+name)
	}
	for _, name := range tests {
		plan := idx.testPlan(name)
		own := production(name)
		if len(plan.internal) > 0 {
			id := "i:" + name
			if len(idx.packages[name]) != 0 {
				own = idx.cacheKeys["p:"+name]
			}
			own = testKey(name, plan.internal, own)
			idx.cacheKeys[id] = own
			ids = append(ids, id)
		}
		if len(plan.external) > 0 {
			id := "e:" + name
			idx.cacheKeys[id] = testKey(name, plan.external, own)
			ids = append(ids, id)
		}
	}
	idx.result.Analysis = &goAnalysis{Units: len(ids)}
	idx.sourceHashes = nil
	if idx.stream.prepare != nil {
		return idx.stream.prepare(slices.DeleteFunc(ids, func(id string) bool { return idx.cacheKeys[id] == "" }))
	}
	return nil
}

func (idx *goIndexer) reuse(id string) goCacheHit {
	if hit, checked := idx.cacheHits[id]; checked {
		return hit
	}
	key := idx.cacheKeys[id]
	if key == "" || idx.emitError != nil {
		return goCacheHit{}
	}
	diagnostics, found, err := idx.stream.load(id, key)
	if err != nil {
		idx.emitError = err
	}
	hit := goCacheHit{found: found, clean: len(diagnostics) == 0}
	idx.cacheHits[id] = hit
	if found {
		idx.result.Analysis.Reused++
		idx.result.Diagnostics = append(idx.result.Diagnostics, diagnostics...)
	}
	return hit
}
