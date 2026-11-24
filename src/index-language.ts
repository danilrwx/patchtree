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

export function indexLanguage(path: string) {
  if (/\.go$|(?:^|\/)go\.(?:mod|work)$/.test(path)) return "go";
  if (/\.[cm]?[jt]sx?$|(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/i.test(path)) return "typescript";
  if (/\.(?:c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|ipp|inc|inl|ixx|cppm)$/i.test(path) ||
      /(?:^|\/)compile_commands\.json$/.test(path)) return "clang";
  return undefined;
}

export type IndexLanguage = NonNullable<ReturnType<typeof indexLanguage>>;
export const largeIndexArchive = 8 * 1024 * 1024;
export const indexLabels: Record<IndexLanguage, string> = {
  go: "Go", typescript: "JavaScript/TypeScript", clang: "C/C++",
};
