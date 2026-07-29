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
import { For, Show, type Accessor } from "solid-js";
import { renderLineHTML, rowMeta, type FileModel, type Gap, type RowMeta, type AlignSide } from "../diff";
import {
  highlights,
  hlKey,
  ctxLines,
  ctxHl,
  ctxKey,
  gapFull,
  gapErr,
} from "../store";
import { DiffFileHeader } from "./DiffFileHeader";

export interface DiffFileProps {
  model: FileModel;
  adds: number;
  dels: number;
  generated: boolean;
  binary: boolean;
  oldPath: string | null;
  newPath: string | null;
  viewed: Accessor<boolean>;
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

const icons = () => (window as any).ptIcons ?? {};

export function DiffFile(props: DiffFileProps) {
  const m = props.model;
  const path = m.path;

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
          <td colspan={4} onClick={() => props.onExpand(p.gap)}>
            <Show when={!gapErr[p.gap.id]} fallback={<span>⚠ {gapErr[p.gap.id]}</span>}>
              <span innerHTML={icons().unfold} /> <span>expand hidden lines</span>
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
          <td colspan={4} onClick={() => props.onExpand(p.gap)}>
            <Show when={!gapErr[p.gap.id]} fallback={<span>⚠ {gapErr[p.gap.id]}</span>}>
              <span innerHTML={icons().unfold} /> <span>expand hidden lines</span>
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
        <tr class="pt-ctx" {...metaAttrs(rowMeta(m, pair.old, pair.new, true))}>
          <td class="pt-no">{pair.old!.no}</td>
          <td class="pt-no">{pair.new!.no}</td>
          <td class="pt-mark" />
          <td class="pt-code" innerHTML={code(pair.new!.text, "new", pair.newRow, null)} />
        </tr>
      );
    return (
      <>
        <Show when={pair.old}>
          <tr class="pt-del" {...metaAttrs(rowMeta(m, pair.old, null, false))}>
            <td class="pt-no">{pair.old!.no}</td>
            <td class="pt-no" />
            <td class="pt-mark">-</td>
            <td class="pt-code" innerHTML={code(pair.old!.text, "old", pair.oldRow, pair.wdA)} />
          </tr>
        </Show>
        <Show when={pair.new}>
          <tr class="pt-add" {...metaAttrs(rowMeta(m, null, pair.new, false))}>
            <td class="pt-no" />
            <td class="pt-no">{pair.new!.no}</td>
            <td class="pt-mark">+</td>
            <td class="pt-code" innerHTML={code(pair.new!.text, "new", pair.newRow, pair.wdB)} />
          </tr>
        </Show>
      </>
    );
  };

  const SplitCell = (p: { entry: AlignSide | null; side: string; row: number | null; cls: string; bg: any }) => (
    <>
      <td class={"pt-no" + (p.entry ? ` ${p.cls}-no` : " pt-void")}>
        <Show when={p.entry}>{p.entry!.no}</Show>
      </td>
      <td
        class={"pt-code" + (p.entry ? ` ${p.cls}-code` : " pt-void")}
        innerHTML={p.entry ? code(p.entry.text, p.side, p.row, p.bg) : ""}
      />
    </>
  );

  const SplitRow = (p: { pair: import("../diff").PairModel }) => {
    const pair = p.pair;
    const cls = pair.ctx ? "pt-ctx" : "pt-del";
    return (
      <tr class="pt-srow" {...metaAttrs(rowMeta(m, pair.old, pair.new, pair.ctx))}>
        <SplitCell entry={pair.old} side="old" row={pair.oldRow} cls={cls} bg={pair.wdA} />
        <SplitCell
          entry={pair.new}
          side="new"
          row={pair.newRow}
          cls={pair.ctx ? "pt-ctx" : "pt-add"}
          bg={pair.wdB}
        />
      </tr>
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
        oldPath={props.oldPath}
        newPath={props.newPath}
        viewed={props.viewed}
        onCopy={props.onCopy}
        onToggleFold={props.onToggleFold}
        onToggleFull={props.onToggleFull}
        onToggleViewed={props.onToggleViewed}
      />
      <Show when={props.binary}>
        <div class="pt-binary">binary file</div>
      </Show>
      <Show when={!props.binary}>
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
                  <Show when={seg.gap}>{(g) => <ExpanderU gap={g()} />}</Show>
                  <Show when={showHeader(seg)}>
                    <tr class="pt-hunk">
                      <td colspan={4}>{hunkText(seg.header)}</td>
                    </tr>
                  </Show>
                  <For each={seg.pairs}>{(pair) => <UnifiedRows pair={pair} />}</For>
                </>
              )}
            </For>
            <Show when={m.trailingGap}>{(g) => <ExpanderU gap={g()} />}</Show>
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
                    <Show when={seg.gap}>{(g) => <ExpanderS gap={g()} />}</Show>
                    <Show when={showHeader(seg)}>
                      <tr class="pt-hunk">
                        <td colspan={4}>{hunkText(seg.header)}</td>
                      </tr>
                    </Show>
                    <For each={seg.pairs}>{(pair) => <SplitRow pair={pair} />}</For>
                  </>
                )}
              </For>
              <Show when={m.trailingGap}>{(g) => <ExpanderS gap={g()} />}</Show>
            </tbody>
          </table>
        </Show>
      </Show>
    </>
  );
}
