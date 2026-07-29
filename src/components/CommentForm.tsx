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
import { createSignal, onMount, Show, type Accessor } from "solid-js";

export interface CommentFormProps {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
  onClose: () => void;
  renderMarkdown: (text: string) => Promise<string>;
  onError: (message: string) => void;
  suggestionText?: string | null;
  onDraft?: ((body: string) => Promise<void>) | null;
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
  const icons = () => (window as any).ptIcons ?? {};
  let ta!: HTMLTextAreaElement;
  const [preview, setPreview] = createSignal(false);
  const [previewHtml, setPreviewHtml] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  onMount(() => setTimeout(() => ta.focus()));

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
    <button type="button" class={cls} title={title} innerHTML={icons()[icon] || icon} onClick={fn} />
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
            const block = "```suggestion:-0+0\n" + props.suggestionText + "\n```\n";
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
