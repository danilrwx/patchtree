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

import { Show, For, type Accessor } from "solid-js";
import { icons } from "../icons";
import { onActivate } from "../a11y";
import { canExpand } from "../store";
import { wordDiff, type Range } from "../diff";

export interface DiffFileHeaderProps {
  path: string;
  adds: number;
  dels: number;
  generated: boolean;
  oldPath: string | null;
  newPath: string | null;
  viewed: Accessor<boolean>;
  onCopy: () => void;
  onToggleFold: () => void;
  onToggleFull: (checked: boolean) => void;
  onToggleViewed: (checked: boolean) => void;
}

// split a path into segments, marking the token ranges that changed (from
// wordDiff), so the rename tooltip highlights exactly what differs
function markup(text: string, ranges: Range[]) {
  const out: { t: string; hi: boolean }[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.s > pos) out.push({ t: text.slice(pos, r.s), hi: false });
    out.push({ t: text.slice(r.s, r.e), hi: true });
    pos = r.e;
  }
  if (pos < text.length) out.push({ t: text.slice(pos), hi: false });
  return out;
}

export function DiffFileHeader(props: DiffFileHeaderProps) {
  const rename = () => !!(props.oldPath && props.newPath && props.oldPath !== props.newPath);
  const rn = () => {
    if (!rename()) return null;
    const wd = wordDiff(props.oldPath!, props.newPath!);
    return {
      old: markup(props.oldPath!, wd?.a ?? []),
      new: markup(props.newPath!, wd?.b ?? []),
    };
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the header holds its own interactive controls (copy button, checkboxes) and cannot nest them inside a native <button>; role="button" is the correct pattern
    <div
      class="pt-file-header"
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as Element).closest(".pt-viewed, .pt-fullfile, .pt-hbtn, a")) return;
        props.onToggleFold();
      }}
      onKeyDown={onActivate(() => props.onToggleFold())}
    >
      <span class="pt-fold" innerHTML={icons.chevron} />
      <span class="pt-path">
        <span class="pt-path-text">{props.path}</span>
      </span>
      <button type="button" class="pt-hbtn" title="Copy path" innerHTML={icons.copy} onClick={() => props.onCopy()} />
      <Show when={rename()}>
        <span class="pt-rename">renamed</span>
      </Show>
      <span class="pt-tip">
        <Show when={rn()} fallback={<div class="pt-tip-path">{props.path}</div>}>
          {(r) => (
            <>
              <div class="pt-tip-path">
                <For each={r().old}>{(s) => (s.hi ? <mark>{s.t}</mark> : s.t)}</For>
              </div>
              <div class="pt-tip-path">
                →&nbsp;
                <For each={r().new}>{(s) => (s.hi ? <mark>{s.t}</mark> : s.t)}</For>
              </div>
            </>
          )}
        </Show>
        <Show when={props.generated}>
          <div class="pt-tip-meta">generated</div>
        </Show>
        <div class="pt-tip-meta">
          +{props.adds} −{props.dels}
        </div>
      </span>
      <Show when={props.generated}>
        <span class="pt-gen-badge">generated</span>
      </Show>
      <span class="pt-stats">
        <span class="pt-adds">+{props.adds}</span> <span class="pt-dels">−{props.dels}</span>
      </span>
      <Show when={canExpand()}>
        <label class="pt-viewed pt-fullfile">
          <input type="checkbox" onChange={(e) => props.onToggleFull(e.currentTarget.checked)} />
          Full file
        </label>
      </Show>
      <label class="pt-viewed">
        <input
          type="checkbox"
          checked={props.viewed()}
          onChange={(e) => props.onToggleViewed(e.currentTarget.checked)}
        />
        Viewed
      </label>
    </div>
  );
}
