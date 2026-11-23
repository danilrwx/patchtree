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
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/scip-code/scip/bindings/go/scip"
)

func resolveSCIP(sources map[string][]string, indexes ...*scip.Index) map[string]map[int]*sourceLine {
	// Local symbol IDs belong to a document in one input index.
	key := func(index int, path, symbol string) string {
		if strings.HasPrefix(symbol, "local ") {
			return strconv.Itoa(index) + "\x00" + path + "\x00" + symbol
		}
		return symbol
	}
	defs := make(map[string][]location)
	for i, index := range indexes {
		for _, doc := range index.Documents {
			lines := sources[doc.RelativePath]
			for _, occ := range doc.Occurrences {
				if occ.Symbol == "" || occ.SymbolRoles&int32(scip.SymbolRole_Definition) == 0 ||
					occ.SymbolRoles&int32(scip.SymbolRole_ForwardDefinition) != 0 {
					continue
				}
				r, ok := occ.SourceRange()
				if !ok {
					continue
				}
				col, ok := byteOffset(lines, r.Start, doc.PositionEncoding)
				if !ok {
					continue
				}
				symbol := key(i, doc.RelativePath, occ.Symbol)
				target := location{doc.RelativePath, int(r.Start.Line) + 1, col}
				if !slices.Contains(defs[symbol], target) {
					defs[symbol] = append(defs[symbol], target)
				}
			}
		}
	}

	files := make(map[string]map[int]*sourceLine)
	for i, index := range indexes {
		for _, doc := range index.Documents {
			lines := sources[doc.RelativePath]
			for _, occ := range doc.Occurrences {
				targets := defs[key(i, doc.RelativePath, occ.Symbol)]
				r, ok := occ.SourceRange()
				if !ok || len(targets) == 0 {
					continue
				}
				start, startOK := byteOffset(lines, r.Start, doc.PositionEncoding)
				end, endOK := byteOffset(lines, r.End, doc.PositionEncoding)
				if !startOK || !endOK || r.Start.Line > r.End.Line {
					continue
				}
				for line := int(r.Start.Line); line <= int(r.End.Line); line++ {
					left, right := 0, len(lines[line])
					if line == int(r.Start.Line) {
						left = start
					}
					if line == int(r.End.Line) {
						right = end
					}
					if left >= right {
						continue
					}
					rows := files[doc.RelativePath]
					if rows == nil {
						rows = make(map[int]*sourceLine)
						files[doc.RelativePath] = rows
					}
					if rows[line+1] == nil {
						rows[line+1] = &sourceLine{Text: lines[line]}
					}
					rows[line+1].Spans = append(rows[line+1].Spans, span{left, right, targets})
				}
			}
		}
	}
	return files
}

func byteOffset(lines []string, pos scip.Position, encoding scip.PositionEncoding) (int, bool) {
	line, col := int(pos.Line), int(pos.Character)
	if line < 0 || line >= len(lines) || col < 0 {
		return 0, false
	}
	text := lines[line]
	switch encoding {
	case scip.PositionEncoding_UnspecifiedPositionEncoding, scip.PositionEncoding_UTF8CodeUnitOffsetFromLineStart:
		return col, col == len(text) || col < len(text) && utf8.RuneStart(text[col])
	case scip.PositionEncoding_UTF16CodeUnitOffsetFromLineStart, scip.PositionEncoding_UTF32CodeUnitOffsetFromLineStart:
		for byteIndex, r := range text {
			if col == 0 {
				return byteIndex, true
			}
			col--
			if encoding == scip.PositionEncoding_UTF16CodeUnitOffsetFromLineStart && r > 0xffff {
				col--
			}
			if col < 0 {
				return 0, false
			}
		}
		return len(text), col == 0
	default:
		return 0, false
	}
}
