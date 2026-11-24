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

import type { clangUnitCache, ClangInputs } from "./index-unit-cache";
import type { IndexProgress } from "./index-runner";
import { indexLanguage } from "./index-language";
import { NavigationMap } from "./navigation-map";

const decoder = new TextDecoder();
const cSource = /\.(?:c|cc|cpp|cxx|c\+\+|ixx|cppm)$/i;
const repo = "/repo/";
export type Occurrence = [path: string, offset: number, width: number, kind: 0 | 1 | 2, usr: string];
type Job = { path: string; flags: string[] };
type ClangModule = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  ccall(name: string, returns: "number", types: ["string"], args: [string]): number;
};
export type ClangFactory = (options: {
  locateFile(name: string): string; print(line: string): void; printErr(line: string): void;
  wasmBinary?: Uint8Array;
}) => Promise<ClangModule>;

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function resolve(base: string, path: string) {
  return normalize(path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) ? path : `${base}/${path}`);
}

// A compilation database command is data. Interpret quotes and escapes only.
function words(command: string) {
  const result: string[] = [];
  const tokens = /("(?:[^"\\]|\\.)*"|'[^']*'|[^\s'"\\]+|\\.)/gy;
  let token = "";
  let active = false;
  for (let offset = 0; offset < command.length;) {
    if (/\s/.test(command[offset])) {
      if (active) result.push(token);
      token = "";
      active = false;
      offset++;
      continue;
    }
    tokens.lastIndex = offset;
    const match = tokens.exec(command);
    if (!match) return [];
    const chunk = match[1];
    token += chunk.startsWith("'") ? chunk.slice(1, -1)
      : chunk.startsWith('"') ? chunk.slice(1, -1).replace(/\\(["\\$\x60])/g, "$1")
      : chunk.startsWith("\\") ? chunk.slice(1) : chunk;
    active = true;
    offset = tokens.lastIndex;
  }
  if (active) result.push(token);
  return result;
}

export function clangJobs(snapshot: ReadonlyMap<string, Uint8Array>, diagnostics: string[], configuredOnly = false) {
  const jobs = new Map<string, Job>();
  const configured = new Set<string>();
  const files = [...snapshot.keys()];
  const suffixes = new Map<string, string | null>();
  for (const path of files.filter((path) => indexLanguage(path) === "clang")) {
    for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
      const suffix = path.slice(at + 1);
      suffixes.set(suffix, suffixes.has(suffix) ? null : path);
    }
  }
  let outside = false;
  let unusable = 0;
  let missing = 0;
  for (const [database, bytes] of snapshot) {
    if (!/(?:^|\/)compile_commands\.json$/.test(database)) continue;
    let commands: unknown;
    try { commands = JSON.parse(decoder.decode(bytes)); } catch { /* Report below. */ }
    if (!Array.isArray(commands)) {
      diagnostics.push(`Cannot read ${database}.`);
      continue;
    }
    for (const command of commands) {
      if (!command || typeof command.file !== "string" || typeof command.directory !== "string") { unusable++; continue; }
      const args: string[] = Array.isArray(command.arguments) && command.arguments.every((arg: unknown) => typeof arg === "string")
        ? command.arguments
        : typeof command.command === "string" ? words(command.command) : [];
      if (!args.length || args.some((arg) => arg.includes("\0"))) { unusable++; continue; }
      const base = resolve(`/${database.split("/").slice(0, -1).join("/")}`, command.directory);
      const absolute = resolve(base, command.file);
      let path: string | undefined;
      let checkout: string | undefined;
      // Match the longest repository-relative suffix of the recorded source path.
      for (let at = 0; at < absolute.length && at >= 0; at = absolute.indexOf("/", at + 1)) {
        const relative = absolute.slice(at + 1);
        if (snapshot.has(relative) && indexLanguage(relative) === "clang") {
          path = relative;
          checkout = absolute.slice(0, at);
          break;
        }
      }
      if (!path || checkout === undefined) {
        // A database for a subproject may record its own checkout as the project root.
        for (let at = 0; at < absolute.length && at >= 0; at = absolute.indexOf("/", at + 1)) {
          const candidate = suffixes.get(absolute.slice(at + 1));
          if (!candidate) continue;
          const anchor = candidate.slice(0, candidate.length - (absolute.length - at - 1));
          if (!(database === `${anchor}compile_commands.json` || database.startsWith(anchor))) continue;
          path = candidate;
          checkout = absolute.slice(0, at);
          break;
        }
      }
      if (!path || checkout === undefined) { missing++; continue; }
      const projectOffset = path.slice(0, path.length - absolute.slice(checkout.length + 1).length);
      const flagPath = (value: string) => {
        const resolved = resolve(base, value);
        if (checkout && resolved !== checkout && !resolved.startsWith(`${checkout}/`)) {
          outside = true;
          return undefined;
        }
        return normalize(`${repo}${projectOffset}/${resolved.slice(checkout.length)}`);
      };
      const flags: string[] = [];
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const include = /^(-isystem|-iquote|-idirafter|-include|-imacros|-I)(.*)$/.exec(arg);
        if (include && !arg.startsWith("-include-")) {
          const value = include[2] || args[++i];
          const mapped = value && flagPath(value);
          if (mapped) {
            const forced = include[1] === "-include" || include[1] === "-imacros";
            const relative = !value.startsWith("/") && !/^[a-z]:[\\/]/i.test(value);
            flags.push(include[1], forced && relative && !snapshot.has(mapped.slice(repo.length)) ? value : mapped);
          }
        } else if (/^-[DU](?:.+)?$/.test(arg)) {
          if (arg.length > 2) flags.push(arg);
          else if (args[i + 1]) flags.push(arg + args[++i]);
        } else if (/^(?:--target|-target|-x|-std)$/.test(arg)) {
          const value = args[++i];
          if (value && /^[\w+.-]+$/.test(value)) {
            if (arg === "-std") flags.push(`-std=${value}`);
            else flags.push(arg, value);
          }
        } else if (/^(?:--target=|-std=)[\w+.-]+$/.test(arg) ||
            /^-(?:nostdinc\+\+|nostdinc|nobuiltininc|pthread|ansi|m(?:32|64)|O[0-3sgz]|f(?:no-)?(?:exceptions|rtti|ms-extensions|ms-compatibility|declspec|unsigned-char|signed-char|short-wchar|short-enums|freestanding|gnu89-inline|blocks|openmp))$/.test(arg) ||
            /^-m(?:arch|cpu|abi|tune)=[\w+.-]+$/.test(arg)) {
          flags.push(arg);
        } else if (/^(?:--sysroot(?:=|$)|-isysroot)/.test(arg)) {
          const option = arg.startsWith("--sysroot") ? "--sysroot" : "-isysroot";
          const value = arg.slice(option.length).replace(/^=/, "") || args[++i];
          const mapped = value && flagPath(value);
          if (mapped) flags.push(option, mapped);
        } else if (/^(?:-o|-MF|-MT|-MQ|-MJ|-Xclang|-Xpreprocessor|-resource-dir|-B|-fmodule-file)$/.test(arg)) {
          i++;
          if (arg !== "-o" && !/^-(?:MF|MT|MQ|MJ)$/.test(arg)) outside = true;
        } else if (/^(?:@|-Wp,|-fmodule|-include-pch|-ivfsoverlay|-nostdlibinc)/.test(arg)) {
          outside = true;
        }
      }
      configured.add(path);
      jobs.set(JSON.stringify([path, flags]), { path, flags });
    }
  }
  if (missing) diagnostics.push(`${missing} compile database entries refer to sources missing from the snapshot.`);
  if (unusable) diagnostics.push(`${unusable} compile database entries could not be read.`);
  if (outside) diagnostics.push("Some C/C++ build flags or paths require build files outside the snapshot or are unsupported.");
  const fallback = files.filter((path) => cSource.test(path) && !configured.has(path));
  if (configuredOnly) {
    if (!jobs.size) throw new Error("Build context has no usable compile commands");
    return [...jobs.values()];
  }
  if (fallback.length) diagnostics.push(`${fallback.length} C/C++ source files have no compile command. Clang used default flags for those files.`);
  for (const path of fallback) jobs.set(path, { path, flags: [] });
  return [...jobs.values()];
}

export function clangMap(
  snapshot: ReadonlyMap<string, Uint8Array>, rows: Iterable<Occurrence>, diagnostics: string[],
) {
  const map = new NavigationMap(snapshot);
  const symbols = new Map<string, Map<string, Occurrence>>();
  for (const row of rows) {
    const [path, offset, width, kind, usr] = row;
    let occurrences = symbols.get(usr);
    if (!occurrences) symbols.set(usr, occurrences = new Map());
    const key = JSON.stringify([path, offset, width]);
    if ((occurrences.get(key)?.[3] ?? -1) < kind) occurrences.set(key, row);
  }
  for (const occurrences of symbols.values()) {
    const rows = [...occurrences.values()];
    const kind = rows.some((row) => row[3] === 2) ? 2 : 1;
    const targets = rows.flatMap(([path, offset, , role]) => {
      const point = role === kind ? map.locate(path, offset) : undefined;
      return point ? [point] : [];
    });
    for (const [path, offset, width] of rows) {
      const from = map.locate(path, offset);
      if (from) map.add(from, width, targets);
    }
  }
  map.diagnostics.push(...diagnostics);
  return map;
}

export async function scanClang(
  factory: ClangFactory, locateFile: (name: string) => string,
  snapshot: ReadonlyMap<string, Uint8Array>, headers: ReadonlyMap<string, Uint8Array>,
  collect: (row: Occurrence) => void,
  flush?: (progress: IndexProgress) => Promise<void>, configuredOnly = false,
  reuse?: Awaited<ReturnType<typeof clangUnitCache>>,
) {
  const diagnostics: string[] = [];
  const jobs = clangJobs(snapshot, diagnostics, configuredOnly);
  const sources = { phase: "sources", completed: 0, total: jobs.length } as const;
  await flush?.(sources);
  const visited = new Set<string>();
  const sysroots = [...new Set(jobs.flatMap(({ flags }) => flags.flatMap((flag, i) =>
    flag === "--sysroot" || flag === "-isysroot" ? [`${flags[i + 1].slice(repo.length).replace(/\/$/, "")}/`] : [])))];
  sysroots.sort();
  const isSystem = (path: string) => sysroots.some((prefix) => path.startsWith(prefix));
  const pending = new Set<string>();
  const keysFor = async (jobs: Job[]) => {
    if (!reuse) return [];
    const keys = await Promise.all(jobs.map(({ path, flags }) => reuse.key(path, flags, sysroots)));
    for (const key of keys) pending.add(key);
    return keys;
  };
  const sourceKeys = await keysFor(jobs);
  const errors = new Set<string>();
  let inputs: ClangInputs | undefined;
  let captured: Occurrence[] | undefined;
  const occurrence = (row: Occurrence) => {
    if (isSystem(row[0])) return;
    visited.add(row[0]);
    collect(row);
    return true;
  };
  const initialize = async () => {
    const module = await factory({
      locateFile,
      print: (line) => {
        if (line.startsWith("[")) {
          const row = JSON.parse(line) as Occurrence;
          if (occurrence(row)) captured?.push(row);
        } else if (reuse && line.startsWith("{")) {
          inputs = JSON.parse(line) as ClangInputs;
        }
      },
      printErr: (line) => {
        if (errors.size < 6 && /(?:fatal )?error:/.test(line)) errors.add(line.replaceAll(repo, ""));
      },
    });
    const mount = (prefix: string, files: ReadonlyMap<string, Uint8Array>) => {
      const dirs = new Set<string>();
      for (const [name, bytes] of files) {
        const path = prefix + name;
        const directory = path.slice(0, path.lastIndexOf("/"));
        if (!dirs.has(directory)) {
          module.FS.mkdirTree(directory);
          dirs.add(directory);
        }
        module.FS.writeFile(path, bytes);
      }
    };
    mount(repo, snapshot);
    mount("/clang/include/", headers);
    return module;
  };
  let module: ClangModule | undefined;
  let failed = 0;
  let reused = 0;
  const run = async ({ path, flags }: Job, key?: string) => {
    if (key && reuse) {
      pending.delete(key);
      const rows = await reuse.load(key).catch(() => undefined);
      if (rows) {
        for (const row of rows) occurrence(row);
        reused++;
        return;
      }
      captured = [];
      inputs = undefined;
    }
    module ??= await initialize();
    const failedJob = module.ccall("patchtree_index", "number", ["string"], [JSON.stringify([
      "-fsyntax-only", "-ferror-limit=8", "-fno-color-diagnostics",
      "-resource-dir", "/clang", ...flags, repo + path,
    ])]);
    if (failedJob) failed++;
    if (!failedJob && key && reuse && captured && inputs) {
      // Always verify the translation unit itself along with Clang's filesystem probes.
      inputs.probes.push(repo + path);
      await reuse.save(key, inputs, captured, pending).catch(() => {});
    }
    captured = undefined;
  };
  for (const [i, job] of jobs.entries()) {
    await run(job, sourceKeys[i]);
    if (flush) await flush({ ...sources, completed: i + 1, reused });
  }
  const standalone = configuredOnly ? [] : [...snapshot.keys()].filter((path) =>
    indexLanguage(path) === "clang" && !cSource.test(path) && !path.endsWith("compile_commands.json") && !visited.has(path) &&
    !isSystem(path));
  if (standalone.length) {
    diagnostics.push(`${standalone.length} C/C++ headers were indexed separately with inferred flags.`);
    const headers = { phase: "headers", completed: 0, total: standalone.length } as const;
    await flush?.(headers);
    const onlyC = jobs.some((job) => /\.c$/.test(job.path)) && !jobs.some((job) => !/\.c$/.test(job.path));
    const headerJobs = standalone.map((path) => ({
      path, flags: ["-x", onlyC && /\.h$/i.test(path) ? "c-header" : "c++-header"],
    }));
    const headerKeys = await keysFor(headerJobs);
    for (const [i, job] of headerJobs.entries()) {
      await run(job, headerKeys[i]);
      if (flush) await flush({ ...headers, completed: i + 1, reused });
    }
  }
  if (failed) diagnostics.push(`Clang could only partially parse ${failed} translation units.`, ...errors);
  return { diagnostics, reused, units: jobs.length + standalone.length };
}

export async function indexClang(
  factory: ClangFactory, locateFile: (name: string) => string,
  snapshot: ReadonlyMap<string, Uint8Array>, headers: ReadonlyMap<string, Uint8Array>,
) {
  const rows: Occurrence[] = [];
  const { diagnostics } = await scanClang(factory, locateFile, snapshot, headers, (row) => rows.push(row));
  return clangMap(snapshot, rows, diagnostics);
}
