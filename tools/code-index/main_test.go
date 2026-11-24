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
	"testing"

	"github.com/scip-code/scip/bindings/go/scip"
)

func TestBuildPreservesByteRangesAndScopesLocals(t *testing.T) {
	const def = int32(scip.SymbolRole_Definition)
	const forward = int32(scip.SymbolRole_ForwardDefinition)
	index := &scip.Index{Documents: []*scip.Document{
		{RelativePath: "a.c", Occurrences: []*scip.Occurrence{
			{Range: []int32{0, 4, 5}, Symbol: "local 0", SymbolRoles: def},
			{Range: []int32{1, 10, 11}, Symbol: "local 0"},
			{Range: []int32{1, 10, 11}, Symbol: "global"},
			{Range: []int32{1, 3, 4}, Symbol: "local 0"}, // inside the UTF-8 encoding of é
		}},
		{RelativePath: "b.c", Occurrences: []*scip.Occurrence{
			{Range: []int32{0, 4, 5}, Symbol: "local 0", SymbolRoles: def},
			{Range: []int32{1, 4, 5}, Symbol: "global", SymbolRoles: def | forward},
			{Range: []int32{2, 4, 5}, Symbol: "global", SymbolRoles: def},
		}},
	}}
	sources := map[string][]string{
		"a.c": {"int x;", ` "é" +    x;`},
		"b.c": {"int y;", "int x;", "int x = 0;"},
	}
	got := resolveSCIP(sources, index)["a.c"][2]
	want := &sourceLine{Text: sources["a.c"][1], Spans: []span{
		{Start: 10, End: 11, Targets: []location{{Path: "a.c", Line: 1, Column: 4}}},
		{Start: 10, End: 11, Targets: []location{{Path: "b.c", Line: 3, Column: 4}}},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolveSCIPEncodingsAndMultipleInputs(t *testing.T) {
	const def = int32(scip.SymbolRole_Definition)
	const first = "scip npm package v1 Thing#"
	const second = "scip npm package v2 Thing#"
	sources := map[string][]string{
		"use.ts":       {"🚀 Thing", " continued"},
		"defs.py":      {"🚀 Thing"},
		"other.py":     {"🚀 Thing"},
		"same-file.ts": {"one two", "x"},
	}
	indexA := &scip.Index{Documents: []*scip.Document{
		{RelativePath: "use.ts", PositionEncoding: scip.PositionEncoding_UTF16CodeUnitOffsetFromLineStart,
			Occurrences: []*scip.Occurrence{
				{Range: []int32{0, 3, 1, 4}, Symbol: first},
				{Range: []int32{0, 1, 2}, Symbol: first}, // splits the UTF-16 surrogate pair
			}},
		{RelativePath: "same-file.ts", Occurrences: []*scip.Occurrence{
			{Range: []int32{0, 0, 3}, Symbol: "local 0", SymbolRoles: def},
			{Range: []int32{1, 0, 1}, Symbol: "local 0"},
		}},
	}}
	indexB := &scip.Index{Documents: []*scip.Document{
		{RelativePath: "defs.py", PositionEncoding: scip.PositionEncoding_UTF32CodeUnitOffsetFromLineStart,
			Occurrences: []*scip.Occurrence{{Range: []int32{0, 2, 7}, Symbol: first, SymbolRoles: def}}},
		{RelativePath: "other.py", PositionEncoding: scip.PositionEncoding_UTF32CodeUnitOffsetFromLineStart,
			Occurrences: []*scip.Occurrence{{Range: []int32{0, 2, 7}, Symbol: second, SymbolRoles: def}}},
		{RelativePath: "same-file.ts", Occurrences: []*scip.Occurrence{
			{Range: []int32{0, 4, 7}, Symbol: "local 0", SymbolRoles: def},
		}},
	}}
	got := resolveSCIP(sources, indexA, indexB)
	dest := []location{{"defs.py", 1, 5}}
	if spans := got["use.ts"][1].Spans; len(spans) != 1 || spans[0].Start != 5 || spans[0].End != 10 ||
		len(spans[0].Targets) != 1 || spans[0].Targets[0] != dest[0] {
		t.Fatalf("wrong UTF-16 to UTF-32 jump: %#v", spans)
	}
	if spans := got["use.ts"][2].Spans; len(spans) != 1 || spans[0].Start != 0 || spans[0].End != 4 {
		t.Fatalf("bad multiline range: %#v", spans)
	}
	if spans := got["same-file.ts"][2].Spans; len(spans) != 1 || len(spans[0].Targets) != 1 ||
		spans[0].Targets[0] != (location{"same-file.ts", 1, 0}) {
		t.Fatalf("local IDs collided across input indexes: %#v", spans)
	}
}
