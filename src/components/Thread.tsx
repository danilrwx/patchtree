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

// Reactive review threads. review.ts loads threads into the store and exposes
// action callbacks via the store's reviewApi; <DiffFile> anchors <CommentsRow>
// after the matching diff row. Replaces the imperative rowsFor/threadRow/
// renderNote machinery and its refreshThreads() full rebuild.
import { For, Show, createSignal, createMemo, createEffect, type JSX } from "solid-js";
import { icons } from "../icons";
import { esc, resolveLang, renderLineHTML, wordDiff, type Range } from "../diff";
import {
  composing,
  setComposing,
  threadIndex,
  reviewThreads,
  reviewApi,
  fileLines,
  anchorKey,
  type ReviewThread,
  type ReviewNote,
  type Composing,
  type SugPart,
  type ReviewApi,
} from "../store";
import { CommentForm } from "./CommentForm";

// the review actions live in the store (set by review.ts); non-null because the
// thread components only ever render once review has populated it
const rv = (): ReviewApi => reviewApi()!;

const EDIT_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/></svg>';
const DEL_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>';

// split a note body into markdown runs and ```suggestion``` blocks
export function splitSuggestions(body: string): SugPart[] {
  const parts: SugPart[] = [];
  const re = /```suggestion(?::-(\d+)\+(\d+))?\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) parts.push({ md: body.slice(last, m.index), minus: 0, plus: 0 });
    parts.push({ sug: m[3].replace(/\n$/, ""), minus: +(m[1] || 0), plus: +(m[2] || 0) });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ md: body.slice(last), minus: 0, plus: 0 });
  return parts;
}

function Markdown(props: { body: string }) {
  const [html, setHtml] = createSignal("");
  createEffect(() => {
    const b = props.body;
    rv()
      .renderMarkdown(b)
      .then(setHtml)
      .catch(() => setHtml(`<p>${esc(b)}</p>`));
  });
  return <div class="pt-md" innerHTML={html()} />;
}

function Suggestion(props: { part: SugPart; thread: ReviewThread; meta?: unknown }) {
  const [applied, setApplied] = createSignal(!!(props.meta as any)?.applied);
  const [dismissed, setDismissed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const line = () => props.thread.pos?.newLine ?? 0;
  // the new-side lines the suggestion replaces, shown as removed rows
  const before = createMemo(() => {
    const pos = props.thread.pos;
    if (!pos || pos.newLine == null) return [];
    const map = fileLines()[pos.path];
    if (!map) return [];
    // GitHub carries the range in the comment (startLine..newLine); GitLab
    // encodes it in the fence header (newLine-minus .. newLine+plus)
    const first =
      pos.startLine != null && pos.startLine < pos.newLine
        ? pos.startLine
        : pos.newLine - props.part.minus;
    const out: string[] = [];
    for (let n = first; n <= pos.newLine + props.part.plus; n++) if (map[n] != null) out.push(map[n]);
    return out;
  });
  const sug = createMemo(() => props.part.sug!.split("\n"));
  // pair removed/proposed lines positionally and word-diff them, so the widget
  // highlights exactly what changed (like GitLab), not just whole ± lines
  const wd = (i: number) => {
    const b = before();
    const s = sug();
    return i < b.length && i < s.length ? wordDiff(b[i], s[i]) : null;
  };
  // syntax-highlight the widget in one round-trip over the removed + proposed
  // lines; rows are 0-based, so proposed lines start after the removed ones
  const [hl, setHl] = createSignal<Record<number, Range[]>>({});
  createEffect(() => {
    const all = [...before(), ...sug()];
    const lang = resolveLang(props.thread.pos?.path || "", all.join("\n"));
    if (!lang || !all.length) return setHl({});
    chrome.runtime
      .sendMessage({ type: "highlight", lang, text: all.join("\n") })
      .then((r: any) => setHl(r?.rows || {}))
      .catch(() => {});
  });
  const canDismiss = () =>
    props.thread.resolvable && !props.thread.resolved && rv().can.resolve && rv().token;
  const canApply = () =>
    rv().can.applySuggestion && rv().token && ((props.meta as any)?.id || line());

  return (
    <div class="pt-sug">
      <div class="pt-sug-head">
        Suggested change
        <Show when={canDismiss() && !dismissed()}>
          <button
            type="button"
            class="pt-apply"
            title="Resolve the thread without applying"
            disabled={busy()}
            onClick={async () => {
              setBusy(true);
              try {
                await rv().dismissSuggestion(props.thread);
                setDismissed(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            Dismiss
          </button>
        </Show>
        <Show when={canApply()}>
          <button
            type="button"
            class="pt-apply"
            disabled={applied() || (props.meta as any)?.appliable === false || busy()}
            onClick={async () => {
              setBusy(true);
              try {
                await rv().applySuggestion(props.thread, props.part, line(), props.meta);
                setApplied(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {applied() ? "Applied" : "Apply suggestion"}
          </button>
        </Show>
      </div>
      <table class="pt-sug-table">
        <tbody>
          <For each={before()}>
            {(l, i) => (
              <tr class="pt-del">
                <td class="pt-mark">−</td>
                <td class="pt-code" innerHTML={renderLineHTML(l, hl()[i()], wd(i())?.a ?? null)} />
              </tr>
            )}
          </For>
          <For each={sug()}>
            {(l, i) => (
              <tr class="pt-add">
                <td class="pt-mark">+</td>
                <td
                  class="pt-code"
                  innerHTML={renderLineHTML(l, hl()[before().length + i()], wd(i())?.b ?? null)}
                />
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function NoteBody(props: { note: ReviewNote; thread: ReviewThread }) {
  const parts = createMemo(() => {
    let i = 0;
    const sugs = props.note.suggestions ?? [];
    return splitSuggestions(props.note.body || "").map((p) =>
      p.sug !== undefined ? { part: p, meta: sugs[i++] } : { part: p, meta: undefined }
    );
  });
  return (
    <div class="pt-note-body">
      <For each={parts()}>
        {(p) => (
          <Show when={p.part.sug !== undefined} fallback={<Markdown body={p.part.md!} />}>
            <Suggestion part={p.part} thread={props.thread} meta={p.meta} />
          </Show>
        )}
      </For>
    </div>
  );
}

function Note(props: { note: ReviewNote; thread: ReviewThread }) {
  const [editing, setEditing] = createSignal(false);
  const [armed, setArmed] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const mine = () =>
    rv().token && rv().me != null && props.note.authorId === rv().me!.id && !props.thread.pending;

  const doDelete = async () => {
    setDeleting(true);
    try {
      // on success the store drops the note and this component unmounts
      await rv().deleteNote(props.thread, props.note);
    } catch {
      setDeleting(false);
      setArmed(false);
    }
  };

  return (
    <div class="pt-note" classList={{ "pt-resolved": props.note.resolved, "pt-pending": props.thread.pending }}>
      <div class="pt-note-head">
        <span class="pt-note-author">{props.thread.pending ? rv().me?.name || "You" : props.note.author}</span>
        <Show
          when={props.thread.pending}
          fallback={<span class="pt-note-date">{new Date(props.note.createdAt).toLocaleString()}</span>}
        >
          <span class="pt-badge-pending">Pending</span>
        </Show>
        <Show when={props.thread.pending}>
          <button type="button" class="pt-draft-del" onClick={() => rv().discardDraft(props.thread)}>
            discard
          </button>
        </Show>
        <Show when={mine()}>
          <span class="pt-note-actions">
            <Show
              when={deleting()}
              fallback={
                <>
                  <button type="button" title="Edit" innerHTML={EDIT_SVG} onClick={() => setEditing(true)} />
                  <Show
                    when={armed()}
                    fallback={
                      <button
                        type="button"
                        title="Delete"
                        innerHTML={DEL_SVG}
                        onClick={() => {
                          setArmed(true);
                          setTimeout(() => setArmed(false), 3000);
                        }}
                      />
                    }
                  >
                    <button type="button" class="pt-confirm-del" onClick={doDelete}>
                      <span innerHTML={DEL_SVG} />
                      Confirm delete
                    </button>
                  </Show>
                </>
              }
            >
              <span class="pt-deleting">
                <span class="pt-spin" />
                Deleting…
              </span>
            </Show>
          </span>
        </Show>
      </div>
      <Show when={editing()} fallback={<NoteBody note={props.note} thread={props.thread} />}>
        <CommentForm
          placeholder="Edit comment…"
          initial={props.note.body}
          submitLabel="Update"
          renderMarkdown={rv().renderMarkdown}
          onError={(m) => rv().status(m, true)}
          onSubmit={(body) => rv().editNote(props.thread, props.note, body)}
          onClose={() => setEditing(false)}
        />
      </Show>
    </div>
  );
}

function ThreadActions(props: { thread: ReviewThread }) {
  const [replying, setReplying] = createSignal(false);
  return (
    <div class="pt-thread-actions">
      <Show
        when={replying()}
        fallback={
          <button
            type="button"
            class="pt-reply-btn"
            innerHTML={`${icons.reply || ""}<span>Reply…</span>`}
            onClick={() => setReplying(true)}
          />
        }
      >
        <CommentForm
          placeholder="Reply…"
          renderMarkdown={rv().renderMarkdown}
          onError={(m) => rv().status(m, true)}
          onSubmit={(body) => rv().reply(props.thread, body)}
          onDraft={rv().can.drafts ? (body) => rv().draftReply(props.thread, body) : null}
          onClose={() => setReplying(false)}
        />
      </Show>
      <Show when={rv().can.resolve && props.thread.resolvable}>
        <button
          type="button"
          class="pt-reply-btn"
          innerHTML={`${icons.check || ""}<span>${props.thread.resolved ? "Unresolve" : "Resolve"}</span>`}
          onClick={() => rv().resolve(props.thread, !props.thread.resolved)}
        />
      </Show>
    </div>
  );
}

function Thread(props: { thread: ReviewThread }) {
  // resolved threads start collapsed to a one-line summary; clicking expands
  const [open, setOpen] = createSignal(false);
  const collapsed = () => props.thread.resolved && !open();
  const count = () => props.thread.notes.length;
  return (
    <Show
      when={!collapsed()}
      fallback={
        <button type="button" class="pt-thread-collapsed" onClick={() => setOpen(true)}>
          <span innerHTML={icons.check || ""} />
          <span>
            Resolved · {count()} comment{count() === 1 ? "" : "s"}
          </span>
          <span class="pt-thread-show">Show</span>
        </button>
      }
    >
      <Show when={props.thread.resolved}>
        <button type="button" class="pt-thread-collapsed pt-thread-hide" onClick={() => setOpen(false)}>
          <span innerHTML={icons.check || ""} />
          <span>Resolved</span>
          <span class="pt-thread-show">Hide</span>
        </button>
      </Show>
      <For each={props.thread.notes}>{(n) => <Note note={n} thread={props.thread} />}</For>
      <Show when={rv().token && !props.thread.pending}>
        <ThreadActions thread={props.thread} />
      </Show>
    </Show>
  );
}

// the comment cell(s): full width in unified, the thread's half in split
function CommentCell(props: { split: boolean; side: string; children: JSX.Element }) {
  return (
    <Show when={props.split} fallback={<td colspan={4}>{props.children}</td>}>
      <Show
        when={props.side === "old"}
        fallback={
          <>
            <td colspan={2} class="pt-void" />
            <td colspan={2}>{props.children}</td>
          </>
        }
      >
        <td colspan={2}>{props.children}</td>
        <td colspan={2} class="pt-void" />
      </Show>
    </Show>
  );
}

function InlineForm(props: { pos: Composing; split: boolean; side: string }) {
  const label = () =>
    props.pos.startLine === props.pos.endLine
      ? `Comment on line ${props.pos.endLine}`
      : `Comment on lines ${props.pos.startLine}–${props.pos.endLine}`;
  // the new-side text of the selected range, to prefill a suggestion block;
  // suggestions only apply to the new side, so skip it for old-side selections
  const suggestion = () => {
    const p = props.pos;
    if (p.side !== "new") return null;
    const map = fileLines()[p.path];
    if (!map) return null;
    const lines: string[] = [];
    for (let n = p.startLine; n <= p.endLine; n++) {
      if (map[n] == null) return null;
      lines.push(map[n]);
    }
    return { text: lines.join("\n"), minus: p.endLine - p.startLine };
  };
  return (
    <tr class="pt-inline-form">
      <CommentCell split={props.split} side={props.side}>
        <div class="pt-comment-lines">{label()}</div>
        <CommentForm
          placeholder="Leave a comment (drag or shift-click line numbers to select a range)…"
          renderMarkdown={rv().renderMarkdown}
          onError={(m) => rv().status(m, true)}
          onSubmit={(body) => rv().submitComment(props.pos, body)}
          onDraft={rv().can.drafts ? (body) => rv().draftComment(props.pos, body) : null}
          onClose={() => setComposing(null)}
          suggestionText={suggestion()?.text ?? null}
          suggestionMinus={suggestion()?.minus ?? 0}
          suggestionSyntax={rv().suggestionSyntax}
        />
      </CommentCell>
    </tr>
  );
}

// General (non-line) discussion, prepended to the diff area by review.js.
export function GeneralThreads() {
  const general = () => reviewThreads().filter((t) => t.general);
  return (
    <Show when={general().length}>
      <details id="pt-mr-threads" open>
        <summary>{`Discussion (${general().length})`}</summary>
        <For each={general()}>
          {(t) => (
            <div class="pt-thread">
              <Thread thread={t} />
            </div>
          )}
        </For>
      </details>
    </Show>
  );
}

// Rendered by <DiffFile> after a diff row: every thread anchored to (path, side,
// line) plus the open comment form, if any, for that anchor.
export function AnchorRows(props: {
  path: string;
  side: string;
  line: number | null;
  split: boolean;
}) {
  const list = () =>
    props.line == null ? [] : threadIndex().get(anchorKey(props.path, props.side, props.line)) ?? [];
  const isComposing = () => {
    const c = composing();
    return !!c && c.path === props.path && c.side === props.side && c.endLine === props.line;
  };
  return (
    <>
      <For each={list()}>
        {(t) => (
          <tr class="pt-comments-row">
            <CommentCell split={props.split} side={props.side}>
              <Thread thread={t} />
            </CommentCell>
          </tr>
        )}
      </For>
      <Show when={isComposing()}>
        <InlineForm pos={composing()!} split={props.split} side={props.side} />
      </Show>
    </>
  );
}
