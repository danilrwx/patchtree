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

export function DiffFileHeader(props: DiffFileHeaderProps) {
  const rename = () => !!(props.oldPath && props.newPath && props.oldPath !== props.newPath);
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
      <span class="pt-path" title={props.path}>{props.path}</span>
      <button type="button" class="pt-hbtn" title="Copy path" innerHTML={icons.copy} onClick={() => props.onCopy()} />
      <Show when={rename()}>
        <span class="pt-rename" title={`renamed from ${props.oldPath}`}>renamed</span>
      </Show>
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
