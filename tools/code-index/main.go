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

//go:build !js

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf8"

	"github.com/scip-code/scip/bindings/go/scip"
	"google.golang.org/protobuf/proto"
)

func git(args ...string) string {
	data, err := exec.Command("git", args...).Output()
	if err != nil {
		log.Fatalf("git %s: %v", strings.Join(args, " "), err)
	}
	return string(data)
}

func loadSources(root string, index *scip.Index, tracked map[string]bool) (map[string][]string, error) {
	sources := make(map[string][]string)
	for _, doc := range index.Documents {
		if !tracked[doc.RelativePath] {
			continue
		}
		data, err := os.ReadFile(filepath.Join(root, doc.RelativePath))
		if err != nil {
			return nil, err
		}
		if !utf8.Valid(data) {
			return nil, fmt.Errorf("%s: source is not UTF-8", doc.RelativePath)
		}
		sources[doc.RelativePath] = strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	}
	return sources, nil
}

func run() error {
	repository := flag.String("repo", "", "HTTPS URL of the reviewed repository (without .git)")
	var indexPaths []string
	flag.Func("scip", "SCIP index built from the current Git checkout (repeatable, default index.scip)", func(path string) error {
		indexPaths = append(indexPaths, path)
		return nil
	})
	goSource := flag.Bool("go-source", false, "index Go sources in the current Git checkout")
	snapshot := flag.Bool("snapshot", false, "index a Go source snapshot (JSON from stdin)")
	goos := flag.String("goos", runtime.GOOS, "target OS for -go-source")
	goarch := flag.String("goarch", runtime.GOARCH, "target architecture for -go-source")
	tags := flag.String("tags", "", "comma-separated Go build tags for -go-source")
	flag.Parse()
	if *snapshot && *goSource || (*snapshot || *goSource) && len(indexPaths) != 0 {
		return fmt.Errorf("choose -snapshot, -go-source or -scip")
	}
	if *snapshot {
		result, err := indexGoJSON(os.Stdin)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	repo, err := url.Parse(*repository)
	if err != nil || repo.Scheme != "https" || repo.Host == "" || repo.Path == "" ||
		repo.User != nil || repo.RawQuery != "" || repo.Fragment != "" {
		return fmt.Errorf("provide -repo with the HTTPS repository URL")
	}
	if git("status", "--porcelain", "--untracked-files=no") != "" {
		return fmt.Errorf("tracked files must match HEAD")
	}
	revision := strings.TrimSpace(git("rev-parse", "HEAD"))
	root := strings.TrimSuffix(git("rev-parse", "--show-toplevel"), "\n")
	tracked := make(map[string]bool)
	for _, entry := range strings.Split(git("ls-tree", "-rz", revision), "\x00") {
		meta, path, ok := strings.Cut(entry, "\t")
		if ok && (strings.HasPrefix(meta, "100644 ") || strings.HasPrefix(meta, "100755 ")) {
			tracked[path] = true
		}
	}
	repoURL := strings.TrimRight(repo.String(), "/")
	var result navigation
	if *goSource {
		var buildTags []string
		if *tags != "" {
			buildTags = strings.Split(*tags, ",")
		}
		input := goSnapshot{Version: 1, Repository: repoURL, Revision: revision, GOOS: *goos, GOARCH: *goarch,
			Tags: buildTags, Sources: make(map[string]string)}
		for name := range tracked {
			if name != "go.work" && !strings.HasSuffix(name, ".go") && filepath.Base(name) != "go.mod" {
				continue
			}
			data, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				return err
			}
			input.Sources[name] = string(data)
		}
		result, err = indexGo(input)
		if err != nil {
			return err
		}
	} else {
		if len(indexPaths) == 0 {
			indexPaths = []string{"index.scip"}
		}
		sources := make(map[string][]string)
		var indexes []*scip.Index
		for _, path := range indexPaths {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			var index scip.Index
			if err := proto.Unmarshal(data, &index); err != nil {
				return fmt.Errorf("%s: %w", path, err)
			}
			indexRoot, err := url.Parse(index.GetMetadata().GetProjectRoot())
			if err != nil || indexRoot.Scheme != "file" || filepath.Clean(indexRoot.Path) != root {
				return fmt.Errorf("%s: SCIP project root must be %s", path, root)
			}
			loaded, err := loadSources(root, &index, tracked)
			if err != nil {
				return err
			}
			for path, lines := range loaded {
				sources[path] = lines
			}
			indexes = append(indexes, &index)
		}
		files := resolveSCIP(sources, indexes...)
		if len(files) == 0 {
			return fmt.Errorf("no navigable references in tracked files")
		}
		result = navigation{Version: 1, Repository: repoURL, Revision: revision, Files: files}
	}
	if strings.TrimSpace(git("rev-parse", "HEAD")) != revision || git("status", "--porcelain", "--untracked-files=no") != "" {
		return fmt.Errorf("checkout changed during export")
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
