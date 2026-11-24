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
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"path"
	"strings"
)

const maxArchiveSize = 128 << 20
const maxSourceSize = 32 << 20

func indexGoArchive(r io.Reader, input goSnapshot) (navigation, error) {
	gzipFile, err := gzip.NewReader(r)
	if err != nil {
		return navigation{}, fmt.Errorf("open source archive: %w", err)
	}
	defer gzipFile.Close()
	contents := &io.LimitedReader{R: gzipFile, N: maxArchiveSize + 1}
	archive := tar.NewReader(contents)
	input.Sources = make(map[string]string)
	var total int64
	for {
		header, err := archive.Next()
		if contents.N == 0 {
			return navigation{}, fmt.Errorf("expanded source archive exceeds %d MiB", maxArchiveSize>>20)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return navigation{}, fmt.Errorf("read source archive: %w", err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		// GitHub and GitLab archives prefix paths with a checkout directory.
		_, name, ok := strings.Cut(header.Name, "/")
		if !ok || !fs.ValidPath(name) || strings.Contains(name, "\\") {
			continue
		}
		if name != "go.work" && path.Base(name) != "go.mod" && !strings.HasSuffix(name, ".go") {
			continue
		}
		total += header.Size
		if total > maxSourceSize {
			return navigation{}, fmt.Errorf("Go sources exceed %d MiB", maxSourceSize>>20)
		}
		text, err := io.ReadAll(archive)
		if err != nil {
			return navigation{}, fmt.Errorf("read %s: %w", name, err)
		}
		input.Sources[name] = string(text)
	}
	return indexGo(input)
}
