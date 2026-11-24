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

type Location = { path: string; line: number; column: number };
type Span = { start: number; end: number; targets: Location[] };
type Line = { text: string; spans: Span[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export class NavigationMap {
  readonly files: Record<string, Record<number, Line>> = Object.create(null);
  readonly diagnostics: string[] = [];
  private readonly lines = new Map<string, number[]>();

  constructor(private readonly snapshot: ReadonlyMap<string, Uint8Array>) {}

  private lineStarts(path: string) {
    const bytes = this.snapshot.get(path);
    if (!bytes) return;
    let lines = this.lines.get(path);
    if (!lines) {
      lines = [0];
      for (let at = bytes.indexOf(10); at >= 0; at = bytes.indexOf(10, at + 1)) lines.push(at + 1);
      this.lines.set(path, lines);
    }
    return lines;
  }

  at(path: string, line: number, column: number) {
    if (!this.lineStarts(path)?.length) return;
    return { path, line, column };
  }

  locate(path: string, offset: number) {
    const lines = this.lineStarts(path);
    if (!lines || offset < 0 || offset >= this.snapshot.get(path)!.length) return;
    let low = 0;
    let high = lines.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lines[middle] > offset) high = middle;
      else low = middle;
    }
    return { path, line: low + 1, column: offset - lines[low] };
  }

  add(location: Location, width: number, targets: Location[]) {
    if (!targets.length || width <= 0) return;
    const { path, line, column } = location;
    const bytes = this.snapshot.get(path);
    const starts = this.lines.get(path);
    if (!bytes || !starts?.length) return;
    const lines = this.files[path] ??= Object.create(null);
    const entry = lines[line] ??= {
      text: decoder.decode(bytes.subarray(starts[line - 1], (starts[line] ?? bytes.length + 1) - 1)).replace(/\r$/, ""),
      spans: [],
    };
    if (column + width > encoder.encode(entry.text).length) return;
    let span = entry.spans.find((span) => span.start === column && span.end === column + width);
    if (!span) {
      span = { start: column, end: column + width, targets: [] };
      entry.spans.push(span);
    }
    for (const target of targets)
      if (!span.targets.some((other) => other.path === target.path && other.line === target.line && other.column === target.column))
        span.targets.push(target);
  }

  serialize(repository: string, revision: string) {
    return JSON.stringify({ version: 1, repository, revision, files: this.files, diagnostics: this.diagnostics });
  }
}
