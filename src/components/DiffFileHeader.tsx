// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
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
