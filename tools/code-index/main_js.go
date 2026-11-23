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

//go:build js && wasm

package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"syscall/js"
)

func encodeIndex(result navigation, err error) string {
	if err == nil {
		data, encodeErr := json.Marshal(result)
		if encodeErr == nil {
			return string(data)
		}
		err = encodeErr
	}
	data, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(data)
}

func main() {
	index := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return `{"error":"expected one Go snapshot as a JSON string"}`
		}
		return encodeIndex(indexGoJSON(strings.NewReader(args[0].String())))
	})
	defer index.Release()
	archive := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 || args[0].Type() != js.TypeString || args[1].Type() != js.TypeString ||
			!args[2].InstanceOf(js.Global().Get("Uint8Array")) {
			return `{"error":"expected repository, revision and gzipped archive bytes"}`
		}
		if args[2].Length() > maxSourceSize {
			return `{"error":"source archive exceeds 32 MiB"}`
		}
		data := make([]byte, args[2].Length())
		js.CopyBytesToGo(data, args[2])
		input := goSnapshot{Version: 1, Repository: args[0].String(), Revision: args[1].String(),
			GOOS: "linux", GOARCH: "amd64"}
		return encodeIndex(indexGoArchive(bytes.NewReader(data), input))
	})
	defer archive.Release()
	js.Global().Set("codeIndexGo", index)
	js.Global().Set("codeIndexGoArchive", archive)
	select {}
}
