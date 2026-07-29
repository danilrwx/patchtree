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

import { createSignal, onMount, Show, } from "solid-js";
import { icons } from "../icons";

export interface CommentFormProps {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
  onClose: () => void;
  renderMarkdown: (text: string) => Promise<string>;
  onError: (message: string) => void;
  suggestionText?: string | null;
  // how many lines above the anchored line the suggestion also replaces
  // (a multi-line selection); becomes the `suggestion:-N+0` block header
  suggestionMinus?: number;
  onDraft?: ((body: string) => Promise<void>) | null;
  // prefill (used by the inline note editor)
  initial?: string;
}

// textarea helpers, ported from review.js surround/prefixLines
function surround(ta: HTMLTextAreaElement, before: string, after = before) {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || "text";
  ta.setRangeText(before + sel + after, s, e);
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
}

function prefixLines(ta: HTMLTextAreaElement, prefixFor: (i: number) => string) {
  const v = ta.value;
  const start = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  let end = v.indexOf("\n", ta.selectionEnd);
  if (end === -1) end = v.length;
  const block = v
    .slice(start, end)
    .split("\n")
    .map((line, i) => prefixFor(i) + line)
    .join("\n");
  ta.setRangeText(block, start, end);
  ta.focus();
  ta.selectionStart = start;
  ta.selectionEnd = start + block.length;
}

export function CommentForm(props: CommentFormProps) {
  let ta!: HTMLTextAreaElement;
  const [preview, setPreview] = createSignal(false);
  const [previewHtml, setPreviewHtml] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    if (props.initial) ta.value = props.initial;
    setTimeout(() => ta.focus());
  });

  const showPreview = async () => {
    setPreviewHtml(
      ta.value.trim() ? await props.renderMarkdown(ta.value) : "<p><i>Nothing to preview</i></p>"
    );
    setPreview(true);
  };

  const run = (fn: (body: string) => Promise<void>) => async () => {
    if (!ta.value.trim() || busy()) return;
    setBusy(true);
    try {
      await fn(ta.value);
      props.onClose();
    } catch (e: any) {
      props.onError(`comment failed: ${e.message}`);
      setBusy(false);
    }
  };

  const tb = (icon: string, title: string, cls: string, fn: () => void) => (
    <button type="button" class={cls} title={title} innerHTML={icons[icon] || icon} onClick={fn} />
  );

  return (
    <div class="pt-comment-form">
      <div class="pt-form-tabs">
        <button type="button" classList={{ "pt-active": !preview() }} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" classList={{ "pt-active": preview() }} onClick={showPreview}>
          Preview
        </button>
      </div>
      <div class="pt-md-bar" style={{ display: preview() ? "none" : "" }}>
        {tb("heading", "Heading", "pt-md-h", () => prefixLines(ta, () => "### "))}
        {tb("bold", "Bold", "pt-md-b", () => surround(ta, "**"))}
        {tb("italic", "Italic", "pt-md-i", () => surround(ta, "_"))}
        {tb("code", "Code", "pt-md-code", () => {
          const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
          if (sel.includes("\n")) surround(ta, "```\n", "\n```");
          else surround(ta, "`");
        })}
        {tb("ul", "Bulleted list", "pt-md-ul", () => prefixLines(ta, () => "- "))}
        {tb("ol", "Numbered list", "pt-md-ol", () => prefixLines(ta, (i) => `${i + 1}. `))}
        <Show when={props.suggestionText != null}>
          {tb("diff", "Insert suggestion", "pt-md-sug", () => {
            const s = ta.selectionStart;
            const block = `\`\`\`suggestion:-${props.suggestionMinus ?? 0}+0\n${props.suggestionText}\n\`\`\`\n`;
            ta.setRangeText(block, s, ta.selectionEnd);
            ta.focus();
            const lineStart = s + block.indexOf("\n") + 1;
            ta.selectionStart = lineStart;
            ta.selectionEnd = lineStart + (props.suggestionText?.length ?? 0);
          })}
        </Show>
      </div>
      <textarea ref={ta} placeholder={props.placeholder} rows={3} style={{ display: preview() ? "none" : "" }} />
      <div class="pt-md pt-form-preview" style={{ display: preview() ? "" : "none" }} innerHTML={previewHtml()} />
      <div class="pt-form-actions">
        <button type="button" onClick={() => props.onClose()}>
          Cancel
        </button>
        <Show when={props.onDraft}>
          <button type="button" disabled={busy()} onClick={run(props.onDraft!)}>
            Add to review
          </button>
        </Show>
        <button type="button" class="pt-primary" disabled={busy()} onClick={run(props.onSubmit)}>
          Comment
        </button>
      </div>
    </div>
  );
}
