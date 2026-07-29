// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import { Show, type Accessor } from "solid-js";

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
  const icons = () => (window as any).ptIcons ?? {};
  const rename = () => !!(props.oldPath && props.newPath && props.oldPath !== props.newPath);
  return (
    <div
      class="pt-file-header"
      onClick={(e) => {
        if ((e.target as Element).closest(".pt-viewed, .pt-fullfile, .pt-hbtn, a")) return;
        props.onToggleFold();
      }}
    >
      <span class="pt-fold" innerHTML={icons().chevron} />
      <span class="pt-path">{props.path}</span>
      <button class="pt-hbtn" title="Copy path" innerHTML={icons().copy} onClick={() => props.onCopy()} />
      <Show when={rename()}>
        <span class="pt-rename">← {props.oldPath}</span>
      </Show>
      <Show when={props.generated}>
        <span class="pt-gen-badge">generated</span>
      </Show>
      <span class="pt-stats">
        <span class="pt-adds">+{props.adds}</span> <span class="pt-dels">−{props.dels}</span>
      </span>
      <label class="pt-viewed pt-fullfile">
        <input type="checkbox" onChange={(e) => props.onToggleFull(e.currentTarget.checked)} />
        Full file
      </label>
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
