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
	"reflect"
	"strings"
	"testing"
)

func TestIndexGoSnapshot(t *testing.T) {
	const mainSource = "var Label = \"é\" + worker.Worker{}.Label()"
	input := goSnapshot{
		Version: 1, Repository: "https://github.com/owner/repo", Revision: "abc", GOOS: "openbsd", GOARCH: "arm",
		Tags: []string{"review"},
		Sources: map[string]string{
			"go.mod":                 "module example.com/repo\n\ngo 1.25\n",
			"use.go":                 "package example\r\nimport \"example.com/repo/worker\"\r\n" + mainSource + "\r\n",
			"worker/label.go":        "package worker\ntype Worker struct{}\ntype Manager struct{}\nfunc (Manager) Label() string { return \"manager\" }\n",
			"worker/review.go":       "//go:build review\n\npackage worker\n//line nowhere:100\nfunc (Worker) Label() string { return \"worker\" }\n",
			"worker/label_linux.go":  "package worker\nfunc (Worker) Label() string { return \"linux\" }\n",
			"worker/review_test.go":  "package worker\nvar TestLabel = Worker{}.Label()\n",
			"worker/export_test.go":  "package worker_test\nimport \"example.com/repo/worker\"\nvar _ = worker.TestLabel\n",
			"nested/go.mod":          "module example.com/other\n",
			"nested/nested.go":       "package nested\nconst Value = 1\n",
			"worker/testdata/foo.go": "package worker\nfunc (Worker) Label() string { return \"testdata\" }\n",
			"unrelated/broken.go":    "package unrelated\nimport \"example.com/other\"\nvar _ = other.Value\n",
		},
	}
	index, err := indexGo(input)
	if err != nil {
		t.Fatal(err)
	}
	streamed := make(map[string]map[int]*sourceLine)
	meta, err := buildGoIndex(input, &goIndexStream{emit: func(_, _ string, files map[string]map[int]*sourceLine, _ []string) error {
		for path, rows := range files {
			if streamed[path] != nil {
				t.Fatalf("file was emitted more than once: %s", path)
			}
			streamed[path] = rows
		}
		return nil
	}})
	if err != nil || len(meta.Files) != 0 || !reflect.DeepEqual(meta.Diagnostics, index.Diagnostics) {
		t.Fatalf("invalid streamed index metadata: %#v (%v)", meta, err)
	}
	for path, rows := range index.Files {
		for line, row := range rows {
			if len(row.Spans) > 0 && !reflect.DeepEqual(streamed[path][line], row) {
				t.Errorf("streamed occurrences differ at %s:%d", path, line)
			}
		}
	}
	if index.Repository != input.Repository || index.Revision != input.Revision {
		t.Fatalf("lost snapshot identity: %s %s", index.Repository, index.Revision)
	}
	row := index.Files["use.go"][3]
	if row == nil || row.Text != mainSource {
		t.Fatalf("wrong source line: %#v", row)
	}
	start := strings.LastIndex(mainSource, "Label")
	want := location{Path: "worker/review.go", Line: 5, Column: 14}
	found := false
	for _, s := range row.Spans {
		if s.Start == start && s.End == start+5 && len(s.Targets) == 1 && s.Targets[0] == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected byte span at %d pointing to %#v, got %#v", start, want, row.Spans)
	}
	if len(index.Diagnostics) != 1 || !strings.Contains(index.Diagnostics[0], "example.com/other") {
		t.Fatalf("unexpected diagnostics: %v", index.Diagnostics)
	}
	for _, test := range []struct {
		file, symbol string
		line         int
		target       location
	}{
		{"worker/review_test.go", "Label", 2, want},
		{"worker/export_test.go", "TestLabel", 3, location{Path: "worker/review_test.go", Line: 2, Column: 4}},
	} {
		row := index.Files[test.file][test.line]
		if row == nil {
			t.Fatalf("missing %s:%d", test.file, test.line)
		}
		start := strings.LastIndex(row.Text, test.symbol)
		found := false
		for _, s := range row.Spans {
			if s.Start == start && s.End == start+len(test.symbol) && len(s.Targets) == 1 && s.Targets[0] == test.target {
				found = true
			}
		}
		if !found {
			t.Errorf("%s:%d: no span for %s to %#v", test.file, test.line, test.symbol, test.target)
		}
	}
	for _, file := range []string{"worker/label_linux.go", "nested/nested.go", "worker/testdata/foo.go"} {
		if index.Files[file] != nil {
			t.Errorf("indexed excluded file %s", file)
		}
	}
}

func TestIndexGoRejectsPathOutsideSnapshot(t *testing.T) {
	_, err := indexGo(goSnapshot{
		Version: 1, Repository: "example.com/repo", Revision: "abc", GOOS: "linux", GOARCH: "amd64",
		Sources: map[string]string{"go.mod": "module example.com/repo\n", "../outside.go": "package example"},
	})
	if err == nil || !strings.Contains(err.Error(), "invalid snapshot path") {
		t.Fatalf("got %v, wanted invalid path error", err)
	}
}

func TestIndexGoWorkspace(t *testing.T) {
	const src = "var _ = lib.Value"
	index, err := indexGo(goSnapshot{
		Version: 1, Repository: "example.com/repo", Revision: "abc", GOOS: "linux", GOARCH: "amd64",
		Sources: map[string]string{
			"go.work":           "go 1.26\nuse (\n ./app\n ./lib\n)\n",
			"app/go.mod":        "module example.com/app\n",
			"app/use.go":        "package app\nimport \"example.com/lib\"\n" + src + "\n",
			"lib/go.mod":        "module example.com/lib\n",
			"lib/def.go":        "package lib\nconst Value = 42\n",
			"lib/unused/go.mod": "module example.com/unused\n",
			"lib/unused/use.go": "package unused\nconst Unused = 9\n",
		},
	})
	if err != nil || len(index.Diagnostics) != 0 {
		t.Fatalf("workspace index: %v, diagnostics: %v", err, index.Diagnostics)
	}
	row := index.Files["app/use.go"][3]
	for _, s := range row.Spans {
		if s.Start == strings.Index(src, "Value") && s.Targets[0].Path == "lib/def.go" {
			if index.Files["lib/unused/use.go"] != nil {
				t.Fatal("nested module outside go.work was indexed")
			}
			return
		}
	}
	t.Fatalf("missing cross-module jump in %#v", row.Spans)
}

func TestEmbeddedTypeDoesNotJumpToItselfWhenImportIsMissing(t *testing.T) {
	src := "package example\nimport \"bytes\"\ntype printer struct { bytes.Buffer }\n"
	index, err := indexGo(goSnapshot{
		Version: 1, Repository: "example.com/repo", Revision: "abc", GOOS: "linux", GOARCH: "amd64",
		Sources: map[string]string{"go.mod": "module example.com/repo\n", "example.go": src},
	})
	if err != nil {
		t.Fatal(err)
	}
	line := index.Files["example.go"][3]
	for _, s := range line.Spans {
		if offset := strings.Index(line.Text, "Buffer"); s.Start <= offset && offset < s.End {
			t.Fatalf("unresolved embedded type produced a jump: %#v", s)
		}
	}
}

func TestGoIncrementalPackageIndex(t *testing.T) {
	input := goSnapshot{
		Version: 1, Repository: "https://example.com/repo", GOOS: "linux", GOARCH: "amd64",
		Sources: map[string]string{
			"go.mod":               "module example.com/repo\n",
			"lib/value.go":         "package lib\nfunc Value() int { return 1 }\n",
			"app/use.go":           "package app\nimport \"example.com/repo/lib\"\nvar Exported = lib.Value()\n",
			"app/internal_test.go": "package app\nvar TestValue = Exported\n",
			"app/external_test.go": "package app_test\nimport \"example.com/repo/app\"\nvar _ = app.TestValue\n",
			"top/outer.go":         "package top\nimport \"example.com/repo/app\"\nvar x = app.Exported\n",
			"independent/other.go": "package independent\nimport \"example.com/repo/notyet\"\nvar _ = notyet.Value\nconst Good = 1\n",
		},
	}
	type entry struct {
		key         string
		files       map[string]map[int]*sourceLine
		diagnostics []string
	}
	saved := map[string]entry{}
	for _, run := range []struct {
		revision, path, change string
		reused                 int
	}{
		{revision: "cold"},
		{revision: "unchanged", reused: 6},
		{revision: "body", path: "lib/value.go", change: "return 2", reused: 5},
		{revision: "tests", path: "app/internal_test.go", change: "// test edit\n", reused: 4},
		{revision: "dependency", path: "lib/value.go", change: "// definition moved\n", reused: 1},
		{revision: "caller", path: "app/use.go", change: "// caller changed\n", reused: 2},
		{revision: "import-added", path: "notyet/value.go", change: "package notyet\nconst Value = 1\n", reused: 5},
	} {
		t.Run(run.revision, func(t *testing.T) {
			input.Revision = run.revision
			if run.revision == "body" {
				input.Sources[run.path] = strings.Replace(input.Sources[run.path], "return 1", run.change, 1)
			} else if run.path != "" {
				input.Sources[run.path] = run.change + input.Sources[run.path]
			}
			files := make(map[string]map[int]*sourceLine)
			collect := func(shard map[string]map[int]*sourceLine) {
				for path, rows := range shard {
					if files[path] != nil {
						t.Fatalf("duplicate shard file %s", path)
					}
					files[path] = rows
				}
			}
			meta, err := buildGoIndex(input, &goIndexStream{
				load: func(id, key string) ([]string, bool, error) {
					result, ok := saved[id]
					if !ok || result.key != key {
						return nil, false, nil
					}
					collect(result.files)
					return result.diagnostics, true, nil
				},
				emit: func(id, key string, files map[string]map[int]*sourceLine, diagnostics []string) error {
					saved[id] = entry{key, files, diagnostics}
					collect(files)
					return nil
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			units := 6
			if run.revision == "import-added" {
				units++
			}
			if want := (goAnalysis{Units: units, Reused: run.reused}); meta.Analysis == nil || *meta.Analysis != want {
				t.Fatalf("analysis = %#v, want %+v", meta.Analysis, want)
			}
			fresh, err := buildGoIndex(input, &goIndexStream{emit: func(_, _ string, shard map[string]map[int]*sourceLine, _ []string) error {
				for path, rows := range shard {
					if !reflect.DeepEqual(rows, files[path]) {
						t.Errorf("cached occurrences differ from a cold index at %s", path)
					}
					delete(files, path)
				}
				return nil
			}})
			if err != nil || len(files) != 0 || !reflect.DeepEqual(meta.Diagnostics, fresh.Diagnostics) {
				t.Fatalf("cached result differs from a cold index: %v, unread files %v, diagnostics %q / %q", err, files, meta.Diagnostics, fresh.Diagnostics)
			}
		})
	}
}
