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

import type TS from "typescript-compiler-api";
import { indexLanguage } from "./index-language";
import { NavigationMap } from "./navigation-map";

type Compiler = typeof TS;
type Directory = { files: string[]; directories: string[] };
const sourcePattern = /\.[cm]?[jt]sx?$/i;
const configPattern = /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const repo = "/repo/";

export function indexTypeScript(ts: Compiler, snapshot: ReadonlyMap<string, Uint8Array>, libraries: ReadonlyMap<string, Uint8Array>) {
  const map = new NavigationMap(snapshot);
  const text = new Map<string, string>();
  const dirs = new Map<string, Directory>();
  const directory = (name: string) => {
    let entry = dirs.get(name);
    if (!entry) dirs.set(name, entry = { files: [], directories: [] });
    return entry;
  };
  const add = (path: string, bytes: Uint8Array) => {
    text.set(path, decoder.decode(bytes));
    let child = path;
    let key = path.lastIndexOf("/");
    directory(path.slice(0, key) || "/").files.push(path.slice(key + 1));
    while (key > 0) {
      child = child.slice(0, key);
      key = child.lastIndexOf("/");
      const parent = directory(child.slice(0, key) || "/");
      const name = child.slice(key + 1);
      if (parent.directories.includes(name)) break;
      parent.directories.push(name);
    }
  };
  for (const [path, bytes] of snapshot)
    if (indexLanguage(path) === "typescript" || path.endsWith(".json")) add(repo + path, bytes);
  for (const [path, bytes] of libraries) add(`/lib/${path}`, bytes);

  const defaults: TS.CompilerOptions = {
    allowJs: true, checkJs: true, jsx: ts.JsxEmit.Preserve, noEmit: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  // Use the pinned compiler's include/exclude matcher with our case-sensitive snapshot.
  const { matchFiles } = ts as Compiler & { matchFiles(
    path: string, extensions: readonly string[] | undefined, excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined, useCaseSensitiveFileNames: boolean, currentDirectory: string,
    depth: number | undefined, getFileSystemEntries: (path: string) => Directory, realpath: (path: string) => string,
  ): string[] };
  const fileExists = (path: string) => text.has(path);
  const readFile = (path: string) => text.get(path);
  const readDirectory: NonNullable<TS.CompilerHost["readDirectory"]> = (path, extensions, exclude, include, depth) =>
    matchFiles(path, extensions, exclude, include, true, repo, depth,
      (path) => dirs.get(path) ?? { files: [], directories: [] }, (path) => path);
  const host: TS.ParseConfigHost = { useCaseSensitiveFileNames: true, fileExists, readFile, readDirectory };
  const compilerHost: TS.CompilerHost & { useSourceOfProjectReferenceRedirect(): boolean } = {
    fileExists, readFile, readDirectory,
    useSourceOfProjectReferenceRedirect: () => true,
    directoryExists: (path) => dirs.has(path),
    getDirectories: (path) => dirs.get(path)?.directories ?? [],
    getSourceFile: (path, version) => {
      const contents = readFile(path);
      return contents === undefined ? undefined : ts.createSourceFile(path, contents, version, true);
    },
    getDefaultLibFileName: (opts) => `/lib/${ts.getDefaultLibFileName(opts)}`,
    writeFile: () => {},
    getCurrentDirectory: () => repo,
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };

  const indexed = new Set<string>();
  function indexProgram(roots: string[], options: TS.CompilerOptions, references?: readonly TS.ProjectReference[]) {
    if (!roots.some((path) => !indexed.has(path))) return;
    const program = ts.createProgram({ rootNames: roots, options, host: compilerHost, projectReferences: references });
    const checker = program.getTypeChecker();
    const positions = new Map<TS.Node, { location: NonNullable<ReturnType<NavigationMap["locate"]>>; width: number }>();
    function position(node: TS.Node) {
      const saved = positions.get(node);
      if (saved) return saved;
      const source = node.getSourceFile();
      if (!source.fileName.startsWith(repo)) return;
      const start = ts.isSourceFile(node) ? 0 : node.getStart(source);
      const { line, character } = source.getLineAndCharacterOfPosition(start);
      const column = encoder.encode(source.text.slice(start - character, start)).length;
      const location = map.at(source.fileName.slice(repo.length), line + 1, column);
      if (!location) return;
      const width = ts.isSourceFile(node) ? 1 : encoder.encode(source.text.slice(start, node.end)).length;
      const result = { location, width };
      positions.set(node, result);
      return result;
    }

    for (const path of roots) {
      if (indexed.has(path)) continue;
      const source = program.getSourceFile(path);
      if (!source) continue;
      indexed.add(path);
      const visit = (node: TS.Node) => {
        if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) ||
            (ts.isStringLiteralLike(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) ||
              ts.isExternalModuleReference(node.parent) || ts.isElementAccessExpression(node.parent)))) {
          let symbol = checker.getSymbolAtLocation(node);
          if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node)
            symbol = checker.getShorthandAssignmentValueSymbol(node.parent) ?? symbol;
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
          const targets = (symbol?.declarations ?? []).flatMap((declaration) => {
            const name = (declaration as TS.NamedDeclaration).name;
            if (!name && !ts.isSourceFile(declaration) && !ts.isIdentifier(declaration)) return [];
            const target = position(name ?? declaration);
            return target ? [target.location] : [];
          });
          if (targets.length) {
            const from = position(node);
            if (from) map.add(from.location, from.width, targets);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const missing = new Set<number>([2307, 2792, 2688, 6053, 6305, 7016]);
    if (program.getOptionsDiagnostics().some((diagnostic) => missing.has(diagnostic.code)) ||
        roots.some((path) => {
          const file = program.getSourceFile(path);
          return file && program.getSemanticDiagnostics(file).some((diagnostic) => missing.has(diagnostic.code));
        })) {
      if (!map.diagnostics.includes("Some JavaScript/TypeScript dependencies or project references are missing from the snapshot."))
        map.diagnostics.push("Some JavaScript/TypeScript dependencies or project references are missing from the snapshot.");
    }
  }

  const names = [...text.keys()].filter((path) => path.startsWith(repo));
  const configs = names.filter((path) => configPattern.test(path))
    .sort((a, b) => b.split("/").length - a.split("/").length || Number(primaryConfig(b)) - Number(primaryConfig(a)) || a.localeCompare(b));
  function primaryConfig(path: string) {
    return /\/(?:tsconfig|jsconfig)\.json$/i.test(path);
  }
  for (const path of configs) {
    const config = ts.readConfigFile(path, readFile);
    if (config.error) {
      map.diagnostics.push(`Cannot read ${path.slice(repo.length)}.`);
      continue;
    }
    if (!primaryConfig(path) && !["files", "include", "references"].some((key) => Object.hasOwn(config.config, key))) continue;
    const parsed = ts.parseJsonConfigFileContent(config.config, host, path.slice(0, path.lastIndexOf("/")), {
      allowJs: true, checkJs: true, jsx: ts.JsxEmit.Preserve,
    }, path);
    for (const error of parsed.errors)
      if (error.code !== 18003) map.diagnostics.push(`${path.slice(repo.length)} — ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
    const roots = parsed.fileNames.filter((path) => path.startsWith(repo));
    indexProgram(roots, { ...parsed.options, noEmit: true }, parsed.projectReferences);
  }
  indexProgram(names.filter((path) => sourcePattern.test(path) && !indexed.has(path)), defaults);
  return map;
}
