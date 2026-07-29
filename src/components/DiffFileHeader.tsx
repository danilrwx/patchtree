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

import { Show, type Accessor } from "solid-js";
import { icons } from "../icons";
import { onActivate } from "../a11y";
import { canExpand } from "../store";

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

// split two paths into their shared prefix/suffix and the differing middles,
// so a rename tooltip can highlight exactly what changed
function diffParts(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return {
    prefix: a.slice(0, p),
    oldMid: a.slice(p, a.length - s),
    newMid: b.slice(p, b.length - s),
    suffix: s ? a.slice(a.length - s) : "",
  };
}

export function DiffFileHeader(props: DiffFileHeaderProps) {
  const rename = () => !!(props.oldPath && props.newPath && props.oldPath !== props.newPath);
  const dp = () => (rename() ? diffParts(props.oldPath!, props.newPath!) : null);
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
        <Show when={dp()} fallback={<div class="pt-tip-path">{props.path}</div>}>
          {(d) => (
            <>
              <div class="pt-tip-path">
                {d().prefix}
                <mark>{d().oldMid}</mark>
                {d().suffix}
              </div>
              <div class="pt-tip-path">
                →&nbsp;{d().prefix}
                <mark>{d().newMid}</mark>
                {d().suffix}
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
