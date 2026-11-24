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
	"fmt"
	"strings"
	"syscall/js"
)

const maxChunkedArchiveDownload = 45 << 20

func awaitIndexValue(callback js.Value, args ...any) (string, error) {
	type reply struct {
		value string
		err   error
	}
	done := make(chan reply, 1)
	ok := js.FuncOf(func(_ js.Value, args []js.Value) any {
		var result reply
		if len(args) > 0 && args[0].Type() == js.TypeString {
			result.value = args[0].String()
		}
		done <- result
		return nil
	})
	defer ok.Release()
	fail := js.FuncOf(func(_ js.Value, args []js.Value) any {
		done <- reply{err: fmt.Errorf("Go index storage: %s", js.Global().Get("String").Invoke(args[0]).String())}
		return nil
	})
	defer fail.Release()
	callback.Invoke(args...).Call("then", ok, fail)
	result := <-done
	return result.value, result.err
}

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
		if (len(args) < 3 || len(args) > 5) || args[0].Type() != js.TypeString || args[1].Type() != js.TypeString ||
			!args[2].InstanceOf(js.Global().Get("Uint8Array")) {
			return `{"error":"expected repository, revision and gzipped archive bytes"}`
		}
		if len(args) == 3 && args[2].Length() > maxSourceSize {
			return `{"error":"source archive exceeds 32 MiB"}`
		}
		if len(args) >= 4 && (args[3].Type() != js.TypeFunction || args[2].Length() > maxChunkedArchiveDownload) {
			return `{"error":"invalid callback or source archive exceeds 45 MiB"}`
		}
		data := make([]byte, args[2].Length())
		js.CopyBytesToGo(data, args[2])
		input := goSnapshot{Version: 1, Repository: args[0].String(), Revision: args[1].String(),
			GOOS: "linux", GOARCH: "amd64"}
		if len(args) == 3 {
			return encodeIndex(indexGoArchive(bytes.NewReader(data), input))
		}
		emit := args[3]
		stream := &goIndexStream{emit: func(id, key string, files map[string]map[int]*sourceLine, diagnostics []string) error {
			encoded, err := json.Marshal(files)
			if err != nil {
				return err
			}
			if diagnostics == nil {
				diagnostics = []string{}
			}
			meta, err := json.Marshal(diagnostics)
			if err != nil {
				return err
			}
			_, err = awaitIndexValue(emit, string(encoded), id, key, string(meta))
			return err
		}}
		if len(args) == 5 {
			reuse := args[4]
			stream.prepare = func(ids []string) error {
				encoded, err := json.Marshal(ids)
				if err != nil {
					return err
				}
				_, err = awaitIndexValue(reuse.Get("prepare"), string(encoded))
				return err
			}
			stream.load = func(id, key string) ([]string, bool, error) {
				text, err := awaitIndexValue(reuse.Get("load"), id, key)
				if text == "" || err != nil {
					return nil, false, err
				}
				var diagnostics []string
				err = json.Unmarshal([]byte(text), &diagnostics)
				return diagnostics, err == nil, err
			}
		}
		executor := js.FuncOf(func(_ js.Value, args []js.Value) any {
			resolve := args[0]
			go func() {
				result, err := buildGoArchiveIndex(bytes.NewReader(data), input, stream)
				resolve.Invoke(encodeIndex(result, err))
			}()
			return nil
		})
		promise := js.Global().Get("Promise").New(executor)
		executor.Release()
		return promise
	})
	defer archive.Release()
	js.Global().Set("codeIndexGo", index)
	js.Global().Set("codeIndexGoArchive", archive)
	select {}
}
