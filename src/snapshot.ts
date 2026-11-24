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

const decoder = new TextDecoder();
const maxExpandedBytes = 512 * 1024 * 1024;

export function snapshotPath(path: string) {
  return path.split("/").every((part) => part && part !== "." && part !== ".." &&
    !part.includes("\\") && [...part].every((char) => char.charCodeAt(0) >= 32));
}

function paxPath(bytes: Uint8Array) {
  for (let from = 0; from < bytes.length;) {
    const separator = bytes.indexOf(32, from);
    const length = Number(decoder.decode(bytes.subarray(from, separator)));
    if (separator < 0 || !Number.isSafeInteger(length) || length <= separator - from || from + length > bytes.length) break;
    const field = decoder.decode(bytes.subarray(separator + 1, from + length - 1));
    if (field.startsWith("path=")) return field.slice(5);
    from += length;
  }
  return undefined;
}

export async function readSnapshot(archive: Uint8Array<ArrayBuffer>, wrapped = true) {
  const reader = new Blob([archive]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxExpandedBytes) {
        await reader.cancel();
        throw new Error("Expanded source archive exceeds 512 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let end = 0;
  for (const chunk of chunks) {
    data.set(chunk, end);
    end += chunk.length;
  }
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const stringAt = (start: number, length: number) =>
    decoder.decode(data.subarray(start, start + length)).split("\0", 1)[0];
  let nextPath: string | undefined;
  for (let start = 0; start + 512 <= data.length;) {
    const name = stringAt(start, 100);
    if (!name) break;
    const prefix = stringAt(start + 345, 155);
    const octal = stringAt(start + 124, 12).trim();
    const length = Number.parseInt(octal, 8);
    const payload = start + 512;
    if (!/^[0-7]+$/.test(octal) || payload + length > data.length) throw new Error("Invalid source archive");
    const type = data[start + 156];
    const bytes = data.subarray(payload, payload + length);
    if (type === 120) nextPath = paxPath(bytes); // PAX extended header
    else if (type === 76) nextPath = decoder.decode(bytes).split("\0", 1)[0]; // GNU long name
    else if (type !== 103) { // global PAX metadata applies to the archive
      const path = (nextPath ?? (prefix ? `${prefix}/${name}` : name)).replace(/^\.\//, "");
      nextPath = undefined;
      const slash = path.indexOf("/");
      const relative = wrapped ? (slash < 0 ? "" : path.slice(slash + 1)) : path;
      if ((type === 0 || type === 48) && snapshotPath(relative)) files.set(relative, bytes);
    }
    start = payload + Math.ceil(length / 512) * 512;
  }
  return files;
}
