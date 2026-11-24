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

import type { Occurrence } from "./clang-index";

export type ClangInputs = { probes: string[]; listings: string[] };
type Unit = {
  used: number; bytes: number; inputs?: Blob; diagnostics?: string; signature: string; rows: Blob;
};
type Budget = { epoch: string; bytes: number; entries: number };
const maxBytes = 128 * 1024 * 1024;
const maxEntries = 8192;
let database: Promise<IDBDatabase> | undefined;

function openUnits() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("patchtree-clang-units", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("units").createIndex("used", "used");
      request.result.createObjectStore("budget");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    database = undefined;
    throw error;
  });
}

function read<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeUnit(
  db: IDBDatabase, epoch: string, key: string, unit: Unit, pending: ReadonlySet<string>,
) {
  if (unit.bytes > maxBytes) return;
  const tx = db.transaction(["units", "budget"], "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const units = tx.objectStore("units");
  const metadata = tx.objectStore("budget");
  const budget = await read<Budget | undefined>(metadata.get("active")) ?? { epoch, bytes: 0, entries: 0 };
  if (budget.epoch === epoch) {
    const previous = await read<Unit | undefined>(units.get(key));
    const next = {
      epoch, bytes: budget.bytes + unit.bytes - (previous?.bytes ?? 0),
      entries: budget.entries + (previous ? 0 : 1),
    };
    const evict: IDBValidKey[] = [];
    const fits = () => next.entries <= maxEntries && next.bytes <= maxBytes;
    const save = () => {
      for (const victim of evict) units.delete(victim);
      units.put(unit, key);
      metadata.put(next, "active");
    };
    if (fits()) save();
    else {
      const oldest = units.index("used").openCursor();
      oldest.onsuccess = () => {
        const cursor = oldest.result;
        if (!cursor) return;
        // A sequential scan should keep entries it will try to reuse later.
        if (pending.has(cursor.primaryKey as string)) return;
        if (cursor.primaryKey !== key) {
          next.bytes -= (cursor.value as Unit).bytes;
          next.entries--;
          evict.push(cursor.primaryKey);
        }
        if (fits()) save();
        else cursor.continue();
      };
    }
  }
  await done;
}

export async function indexUnitStats() {
  const db = await openUnits();
  const budget = await read<Budget | undefined>(db.transaction("budget").objectStore("budget").get("active"));
  return { bytes: budget?.bytes ?? 0, entries: budget?.entries ?? 0 };
}

export async function clearIndexUnits(epoch: string) {
  const db = await openUnits();
  const tx = db.transaction(["units", "budget"], "readwrite");
  tx.objectStore("units").clear();
  tx.objectStore("budget").put({ epoch, bytes: 0, entries: 0 }, "active");
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

async function loadUnit(db: IDBDatabase, epoch: string, key: string) {
  const tx = db.transaction(["units", "budget"], "readonly");
  const [budget, unit] = await Promise.all([
    read<Budget | undefined>(tx.objectStore("budget").get("active")),
    read<Unit | undefined>(tx.objectStore("units").get(key)),
  ]);
  if (budget?.epoch === epoch) return unit;
}

export async function goUnitCache(scope: string, epoch: string) {
  const db = await openUnits();
  const key = (id: string) => JSON.stringify(["go", scope, id]);
  let pending = new Set<string>();
  return {
    prepare(ids: string[]) { pending = new Set(ids.map(key)); },
    async load(id: string, signature: string) {
      const name = key(id);
      pending.delete(name);
      const unit = await loadUnit(db, epoch, name);
      if (unit?.signature === signature) return unit;
    },
    async save(id: string, signature: string, rows: Blob, diagnostics: string) {
      const name = key(id);
      pending.delete(name);
      const bytes = rows.size + 2 * diagnostics.length + 256;
      await storeUnit(db, epoch, name, { used: Date.now(), bytes, signature, rows, diagnostics }, pending);
    },
  };
}

async function compress(value: unknown) {
  const body = new Blob([JSON.stringify(value)]);
  return new Response(body.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

function unpack<T>(body: Blob): Promise<T> {
  const stream = body.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

async function digest(value: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function clangUnitCache(
  snapshot: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, scope: string, epoch: string,
) {
  const db = await openUnits();
  const encoder = new TextEncoder();
  const directories = new Map<string, Set<string>>();
  for (const path of snapshot.keys()) {
    let child = path;
    while (child) {
      const slash = child.lastIndexOf("/");
      const parent = slash < 0 ? "" : child.slice(0, slash);
      const name = child.slice(slash + 1);
      const known = directories.get(parent);
      if (known?.has(name)) break;
      if (known) known.add(name);
      else directories.set(parent, new Set([name]));
      child = parent;
    }
  }
  const fingerprints = new Map<string, Promise<string>>();
  function fingerprint(absolute: string, listing: boolean) {
    const key = JSON.stringify([absolute, listing]);
    let value = fingerprints.get(key);
    if (!value) {
      const parts: string[] = [];
      // The mounted Emscripten filesystem normalizes paths before resolving them.
      for (const part of absolute.split("/")) {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
      }
      const path = parts.slice(1).join("/");
      const file = parts[0] === "repo" ? snapshot.get(path) : undefined;
      const directory = parts[0] === "repo" ? directories.get(path) : undefined;
      value = file ? digest(file) : listing && directory
        ? digest(encoder.encode(JSON.stringify([...directory].map((name) => [name, directories.has(path ? `${path}/${name}` : name)]))))
        : Promise.resolve(directory ? "directory" : "missing");
      fingerprints.set(key, value);
    }
    return value;
  }
  const signature = async (inputs: ClangInputs) => digest(encoder.encode(JSON.stringify(await Promise.all([
    ...inputs.probes.map((path) => fingerprint(path, false)),
    ...inputs.listings.map((path) => fingerprint(path, true)),
  ]))));
  return {
    key: (path: string, flags: string[], sysroots: string[]) => digest(encoder.encode(JSON.stringify([scope, path, flags, sysroots]))),
    async load(key: string) {
      const unit = await loadUnit(db, epoch, key);
      if (!unit?.inputs || unit.signature !== await signature(await unpack<ClangInputs>(unit.inputs))) return;
      return unpack<Occurrence[]>(unit.rows);
    },
    async save(key: string, inputs: ClangInputs, occurrences: Occurrence[], pending: ReadonlySet<string>) {
      const [rows, dependencies, expected] = await Promise.all([
        compress(occurrences), compress(inputs), signature(inputs),
      ]);
      const bytes = rows.size + dependencies.size + 256;
      await storeUnit(db, epoch, key, { used: Date.now(), bytes, inputs: dependencies, signature: expected, rows }, pending);
    },
  };
}
