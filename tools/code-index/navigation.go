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

type location struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

type span struct {
	Start   int        `json:"start"`
	End     int        `json:"end"`
	Targets []location `json:"targets"`
}

type sourceLine struct {
	Text  string `json:"text"`
	Spans []span `json:"spans"`
}

type navigation struct {
	Version     int                            `json:"version"`
	Repository  string                         `json:"repository"`
	Revision    string                         `json:"revision"`
	Files       map[string]map[int]*sourceLine `json:"files"`
	Diagnostics []string                       `json:"diagnostics,omitempty"`
	Analysis    *goAnalysis                    `json:"analysis,omitempty"`
}
