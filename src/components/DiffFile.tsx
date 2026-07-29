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

import { For, Show, type Accessor } from "solid-js";
import { icons } from "../icons";
import { clickable } from "../a11y";
import {
  renderLineHTML,
  rowMeta,
  wordDiff,
  type FileModel,
  type Gap,
  type RowMeta,
  type AlignSide,
} from "../diff";
import {
  highlights,
  hlKey,
  ctxLines,
  ctxHl,
  ctxKey,
  gapFull,
  gapErr,
  canExpand,
  inComposeRange,
} from "../store";
import { DiffFileHeader } from "./DiffFileHeader";
import { AnchorRows } from "./Thread";

export interface DiffFileProps {
  model: FileModel;
  adds: number;
  dels: number;
  generated: boolean;
  binary: boolean;
  renamed: boolean;
  oldPath: string | null;
  newPath: string | null;
  viewed: Accessor<boolean>;
  // false until the file scrolls near the viewport — defers building the row
  // DOM/reactivity so a big diff doesn't mount every file up front
  mount: Accessor<boolean>;
  onCopy: () => void;
  onToggleFold: () => void;
  onToggleFull: (checked: boolean) => void;
  onToggleViewed: (checked: boolean) => void;
  onExpand: (gap: Gap) => void;
}

function metaAttrs(m: RowMeta): Record<string, string> {
  const a: Record<string, string> = {
    "data-path": m.path,
    "data-old-path": m.oldPath,
    "data-code-old": String(m.codeOld),
    "data-code-new": String(m.codeNew),
  };
  if (m.old != null) a["data-old"] = String(m.old);
  if (m.new != null) a["data-new"] = String(m.new);
  if (m.ctx) a["data-ctx"] = "1";
  return a;
}


export function DiffFile(props: DiffFileProps) {
  const m = props.model;
  const path = m.path;
  // rough row count for the pre-mount placeholder, so the scrollbar stays stable
  const estRows = m.segments.reduce((a, s) => a + s.pairs.length + 1, 0);

  // a rename has no line content of its own; show the path change as a diff
  // (old − / new +) with the differing tokens word-highlighted
  const renamed = props.renamed && !!props.oldPath && !!props.newPath;
  const nameWd = renamed ? wordDiff(props.oldPath!, props.newPath!) : null;

  // reactive line HTML: text + stored highlight ranges (+ optional word-diff bg)
  const code = (text: string, side: string, row: number | null, bg: any) =>
    renderLineHTML(text, row != null ? highlights[hlKey(path, side, row)] : null, bg);

  const ctxMeta = (o: number, n: number): RowMeta => ({
    path,
    oldPath: m.oldPath,
    old: o,
    new: n,
    ctx: true,
    codeOld: o,
    codeNew: n,
  });

  const ExpanderU = (p: { gap: Gap }) => (
    <Show
      when={ctxLines[p.gap.id]}
      fallback={
        <tr class="pt-expander">
          <td colspan={4} {...clickable(() => props.onExpand(p.gap))}>
            <Show when={!gapErr[p.gap.id]} fallback={<span>⚠ {gapErr[p.gap.id]}</span>}>
              <span innerHTML={icons.unfold} /> <span>expand hidden lines</span>
            </Show>
          </td>
        </tr>
      }
    >
      <For each={ctxLines[p.gap.id]}>
        {(cl, i) => (
          <tr class="pt-ctx pt-exp" {...metaAttrs(ctxMeta(cl.o, cl.n))}>
            <td class="pt-no">{cl.o}</td>
            <td class="pt-no">{cl.n}</td>
            <td class="pt-mark" />
            <td class="pt-code" innerHTML={renderLineHTML(cl.text, ctxHl[ctxKey(p.gap.id, i())], null)} />
          </tr>
        )}
      </For>
    </Show>
  );

  const ExpanderS = (p: { gap: Gap }) => (
    <Show
      when={ctxLines[p.gap.id]}
      fallback={
        <tr class="pt-expander">
          <td colspan={4} {...clickable(() => props.onExpand(p.gap))}>
            <Show when={!gapErr[p.gap.id]} fallback={<span>⚠ {gapErr[p.gap.id]}</span>}>
              <span innerHTML={icons.unfold} /> <span>expand hidden lines</span>
            </Show>
          </td>
        </tr>
      }
    >
      <For each={ctxLines[p.gap.id]}>
        {(cl, i) => {
          const html = () => renderLineHTML(cl.text, ctxHl[ctxKey(p.gap.id, i())], null);
          return (
            <tr class="pt-srow pt-exp" {...metaAttrs(ctxMeta(cl.o, cl.n))}>
              <td class="pt-no pt-ctx-no">{cl.o}</td>
              <td class="pt-code pt-ctx-code" innerHTML={html()} />
              <td class="pt-no pt-ctx-no">{cl.n}</td>
              <td class="pt-code pt-ctx-code" innerHTML={html()} />
            </tr>
          );
        }}
      </For>
    </Show>
  );

  const UnifiedRows = (p: { pair: import("../diff").PairModel }) => {
    const pair = p.pair;
    if (pair.ctx)
      return (
        <>
          <tr
            class="pt-ctx"
            classList={{
              "pt-range":
                inComposeRange(path, "new", pair.new!.no) ||
                inComposeRange(path, "old", pair.old!.no),
            }}
            {...metaAttrs(rowMeta(m, pair.old, pair.new, true))}
          >
            <td class="pt-no">{pair.old!.no}</td>
            <td class="pt-no">{pair.new!.no}</td>
            <td class="pt-mark" />
            <td class="pt-code" innerHTML={code(pair.new!.text, "new", pair.newRow, null)} />
          </tr>
          <AnchorRows path={path} side="new" line={pair.new!.no} split={false} />
          <AnchorRows path={path} side="old" line={pair.old!.no} split={false} />
        </>
      );
    return (
      <>
        <Show when={pair.old}>
          <tr
            class="pt-del"
            classList={{ "pt-range": inComposeRange(path, "old", pair.old!.no) }}
            {...metaAttrs(rowMeta(m, pair.old, null, false))}
          >
            <td class="pt-no">{pair.old!.no}</td>
            <td class="pt-no" />
            <td class="pt-mark">-</td>
            <td class="pt-code" innerHTML={code(pair.old!.text, "old", pair.oldRow, pair.wdA)} />
          </tr>
          <AnchorRows path={path} side="old" line={pair.old!.no} split={false} />
        </Show>
        <Show when={pair.new}>
          <tr
            class="pt-add"
            classList={{ "pt-range": inComposeRange(path, "new", pair.new!.no) }}
            {...metaAttrs(rowMeta(m, null, pair.new, false))}
          >
            <td class="pt-no" />
            <td class="pt-no">{pair.new!.no}</td>
            <td class="pt-mark">+</td>
            <td class="pt-code" innerHTML={code(pair.new!.text, "new", pair.newRow, pair.wdB)} />
          </tr>
          <AnchorRows path={path} side="new" line={pair.new!.no} split={false} />
        </Show>
      </>
    );
  };

  const SplitCell = (p: { entry: AlignSide | null; side: string; row: number | null; cls: string; bg: any }) => (
    <>
      <td class={`pt-no${p.entry ? ` ${p.cls}-no` : " pt-void"}`}>
        <Show when={p.entry}>{p.entry!.no}</Show>
      </td>
      <td
        class={`pt-code${p.entry ? ` ${p.cls}-code` : " pt-void"}`}
        innerHTML={p.entry ? code(p.entry.text, p.side, p.row, p.bg) : ""}
      />
    </>
  );

  const SplitRow = (p: { pair: import("../diff").PairModel }) => {
    const pair = p.pair;
    const cls = pair.ctx ? "pt-ctx" : "pt-del";
    return (
      <>
        <tr
          class="pt-srow"
          classList={{
            "pt-range":
              inComposeRange(path, "new", pair.new?.no ?? null) ||
              inComposeRange(path, "old", pair.old?.no ?? null),
          }}
          {...metaAttrs(rowMeta(m, pair.old, pair.new, pair.ctx))}
        >
          <SplitCell entry={pair.old} side="old" row={pair.oldRow} cls={cls} bg={pair.wdA} />
          <SplitCell
            entry={pair.new}
            side="new"
            row={pair.newRow}
            cls={pair.ctx ? "pt-ctx" : "pt-add"}
            bg={pair.wdB}
          />
        </tr>
        <AnchorRows path={path} side="new" line={pair.new?.no ?? null} split={true} />
        <AnchorRows path={path} side="old" line={pair.old?.no ?? null} split={true} />
      </>
    );
  };

  const hunkText = (h: { oldStart: number; newStart: number; context: string }) =>
    `@@ -${h.oldStart} +${h.newStart} @@${h.context}`;
  const showHeader = (seg: { gap: Gap | null }) => !(seg.gap && gapFull[seg.gap.id]);

  return (
    <>
      <DiffFileHeader
        path={path}
        adds={props.adds}
        dels={props.dels}
        generated={props.generated}
        renamed={renamed}
        viewed={props.viewed}
        onCopy={props.onCopy}
        onToggleFold={props.onToggleFold}
        onToggleFull={props.onToggleFull}
        onToggleViewed={props.onToggleViewed}
      />
      <div class="pt-file-body">
      <Show when={renamed}>
        <table class="pt-table pt-namediff">
          <colgroup>
            <col style="width:44px" />
            <col style="width:44px" />
            <col style="width:16px" />
            <col />
          </colgroup>
          <tbody>
            <tr class="pt-del">
              <td class="pt-no" />
              <td class="pt-no" />
              <td class="pt-mark">-</td>
              <td class="pt-code" innerHTML={renderLineHTML(props.oldPath!, null, nameWd?.a ?? null)} />
            </tr>
            <tr class="pt-add">
              <td class="pt-no" />
              <td class="pt-no" />
              <td class="pt-mark">+</td>
              <td class="pt-code" innerHTML={renderLineHTML(props.newPath!, null, nameWd?.b ?? null)} />
            </tr>
          </tbody>
        </table>
      </Show>
      <Show when={props.binary}>
        <div class="pt-binary">binary file</div>
      </Show>
      <Show when={!props.binary && props.mount()} fallback={<Show when={!props.binary}><div class="pt-file-ph" style={{ height: `${estRows * 19}px` }} /></Show>}>
        <table class="pt-table pt-unified">
          <colgroup>
            <col style="width:44px" />
            <col style="width:44px" />
            <col style="width:16px" />
            <col />
          </colgroup>
          <tbody>
            <For each={m.segments}>
              {(seg) => (
                <>
                  <Show when={canExpand() && seg.gap}>{(g) => <ExpanderU gap={g()} />}</Show>
                  <Show when={showHeader(seg)}>
                    <tr class="pt-hunk">
                      <td colspan={4}>{hunkText(seg.header)}</td>
                    </tr>
                  </Show>
                  <For each={seg.pairs}>{(pair) => <UnifiedRows pair={pair} />}</For>
                </>
              )}
            </For>
            <Show when={canExpand() && m.trailingGap}>{(g) => <ExpanderU gap={g()} />}</Show>
          </tbody>
        </table>
        <Show when={!m.full}>
          <table class="pt-table pt-split">
            <colgroup>
              <col style="width:44px" />
              <col />
              <col style="width:44px" />
              <col />
            </colgroup>
            <tbody>
              <For each={m.segments}>
                {(seg) => (
                  <>
                    <Show when={canExpand() && seg.gap}>{(g) => <ExpanderS gap={g()} />}</Show>
                    <Show when={showHeader(seg)}>
                      <tr class="pt-hunk">
                        <td colspan={4}>{hunkText(seg.header)}</td>
                      </tr>
                    </Show>
                    <For each={seg.pairs}>{(pair) => <SplitRow pair={pair} />}</For>
                  </>
                )}
              </For>
              <Show when={canExpand() && m.trailingGap}>{(g) => <ExpanderS gap={g()} />}</Show>
            </tbody>
          </table>
        </Show>
      </Show>
      </div>
    </>
  );
}
