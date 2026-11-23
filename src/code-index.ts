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

import { archiveLocation, loadArchive } from "./source-archive";
import { renderLineHTML, resolveLang, type Range as HighlightRange } from "./diff";
import { icons } from "./icons";
import { indexLabels, indexLanguage, type IndexLanguage } from "./index-language";
import { flashCenter } from "./ui";
import { credentialFor, gitlabHeaders } from "./providers/shared";
import type { PtView } from "./review";
import type { Provider } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPath(value: unknown): value is string {
  return typeof value === "string" &&
    !value.includes("\\") && [...value].every((char) => char.charCodeAt(0) >= 32) &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Definition = { path: string; line: number; column: number; href: string; text?: string };
type DefinitionLinks = Map<string, Definition>;
type CodeSymbol = { name: string; links: DefinitionLinks; range?: Range };
type Reference = { path: string; line: number; column: number; end: number; text: string };
type ReferenceGroups = Map<string, Reference[]>;

function isReferencesShortcut(event: KeyboardEvent) {
  return event.key === "F12" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
}

function caretColumn(cell: HTMLElement, selection: Selection) {
  const node = selection.focusNode;
  if (!node || !cell.contains(node)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(cell);
  prefix.setEnd(node, selection.focusOffset);
  return encoder.encode(prefix.toString()).length;
}

function byteColumn(cell: HTMLElement, event: MouseEvent) {
  const pos = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  const fallback = pos ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = pos?.offsetNode ?? fallback?.startContainer;
  const offset = pos?.offset ?? fallback?.startOffset;
  if (!node || offset === undefined || node.nodeType !== Node.TEXT_NODE || !cell.contains(node)) return null;
  const previous = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  previous.currentNode = node;
  const prevNode = offset > 0 ? node : previous.previousNode();
  const prevEnd = offset > 0 ? offset : prevNode?.textContent?.length ?? 0;
  const prefix = document.createRange();
  prefix.selectNodeContents(cell);
  prefix.setEnd(node, offset);
  // The caret API picks the nearest boundary. The right half of a glyph
  // can therefore report the position just past the indexed token.
  if (prevNode && prevEnd > 0) {
    const low = prevNode.textContent!.charCodeAt(prevEnd - 1);
    const prevStart = prevEnd - (prevEnd >= 2 && low >= 0xdc00 && low <= 0xdfff ? 2 : 1);
    const glyph = document.createRange();
    glyph.setStart(prevNode, prevStart);
    glyph.setEnd(prevNode, prevEnd);
    const box = glyph.getBoundingClientRect();
    if (event.clientX >= box.left && event.clientX < box.right &&
        event.clientY >= box.top && event.clientY < box.bottom) prefix.setEnd(prevNode, prevStart);
  }
  return encoder.encode(prefix.toString()).length;
}

export function installCodeNavigation(P: Provider, view: PtView, revision: string, sourceProject: string | undefined, isFullDiff: () => boolean) {
  let files: Record<string, unknown> | null = null;
  const recentReferences = new Map<string, ReferenceGroups>();
  let importRequest = 0;
  let imported = false;
  const indexed = new Map<IndexLanguage | "import", string[]>();
  const indexers = new Map<IndexLanguage, () => Promise<void>>();
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Import…";
  button.setAttribute("aria-label", "Import code index");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  // Keep File objects out of reach of scripts on the reviewed site.
  input.hidden = true;
  const picker = document.createElement("span");
  picker.attachShadow({ mode: "closed" }).append(input);
  const controls = document.createElement("span");
  const status = document.createElement("small");
  status.setAttribute("role", "status");
  const limitations = document.createElement("details");
  limitations.hidden = true;
  controls.append(button, picker, status, limitations);
  view.addSettingRow("Code index", controls);

  function apply(data: unknown, language?: IndexLanguage) {
    if (!record(data) || data.version !== 1 || !record(data.files)) throw new Error("Invalid code index");
    if (data.repository !== P.repository || data.revision !== revision)
      throw new Error("Code index belongs to a different repository or revision");
    if (!language) {
      indexed.clear();
      imported = true;
    }
    files = language ? Object.assign(Object.create(null), files, data.files) : data.files;
    recentReferences.clear();
    indexed.set(language ?? "import", Array.isArray(data.diagnostics)
      ? data.diagnostics.filter((message): message is string => typeof message === "string") : []);
    const diagnostics = [...indexed.values()].flat();
    status.textContent = ` ${diagnostics.length ? "Partially indexed" : "Indexed"} ${revision.slice(0, 8)}`;
    status.title = diagnostics.join("\n");
    limitations.replaceChildren();
    limitations.hidden = !diagnostics.length;
    if (diagnostics.length) {
      const summary = document.createElement("summary");
      summary.textContent = "Indexing limitations";
      const list = document.createElement("ul");
      for (const message of diagnostics) {
        const item = document.createElement("li");
        item.textContent = message;
        list.append(item);
      }
      limitations.append(summary, list);
    }
  }

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const request = ++importRequest;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("Code index exceeds 64 MiB");
      const data: unknown = JSON.parse(await file.text());
      if (request === importRequest) apply(data);
    } catch (error) {
      if (request === importRequest)
        status.textContent = error instanceof Error ? ` ${error.message}` : " Cannot read code index";
    }
  });

  const languages = new Set(Array.from(view.root.querySelectorAll<HTMLElement>(".pt-file[data-path]"),
    (file) => indexLanguage(file.dataset.path!)).filter((language) => language !== undefined));
  let gitlabArchive: Promise<string> | undefined;
  function uploadGitlabArchive() {
    return gitlabArchive ??= (async () => {
      // Self-hosted GitLab archives can be fetched from the MR origin.
      const { archive } = archiveLocation(location.href, sourceProject, revision);
      const headers = gitlabHeaders(await credentialFor(location.host));
      const bytes = await loadArchive(await fetch(archive, { headers, credentials: "omit", redirect: "error" }));
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    })().finally(() => { gitlabArchive = undefined; });
  }
  for (const language of languages) {
    const label = indexLabels[language];
    const build = document.createElement("button");
    build.type = "button";
    build.textContent = `Index ${label}`;
    build.setAttribute("aria-label", `Index ${label} sources`);
    controls.insertBefore(build, button);
    const message = { type: "repositoryIndex", revision, sourceProject, language };
    const cached = chrome.runtime.sendMessage({ ...message, cachedOnly: true })
      .then((reply) => reply?.index ? unpackIndex(reply) : undefined)
      .catch(() => undefined);
    void cached.then((data) => {
      if (data && importRequest === 0) apply(data, language);
    }).catch(() => {});
    let pending: Promise<void> | undefined;
    const download = async () => {
      const request = importRequest;
      build.disabled = true;
      status.textContent = ` Indexing ${label}…`;
      try {
        let data = await cached;
        if (!data) {
          let reply = await chrome.runtime.sendMessage(message);
          if (!reply && P.kind === "gitlab")
            reply = await chrome.runtime.sendMessage({ ...message, archiveBase64: await uploadGitlabArchive() });
          if (!reply?.index) throw new Error(reply?.error || "Could not index repository");
          data = await unpackIndex(reply);
        }
        if (request === importRequest) apply(data, language);
      } catch (error) {
        if (request === importRequest)
          status.textContent = error instanceof Error ? ` ${error.message}` : " Could not index repository";
        throw error;
      } finally {
        build.disabled = false;
      }
    };
    const index = () => pending ??= download().finally(() => { pending = undefined; });
    indexers.set(language, index);
    build.addEventListener("click", () => { void index().catch(() => {}); });
  }

  let hovered: HTMLElement | null = null;
  let panel: HTMLDialogElement | null = null;
  let panelEvents: AbortController | null = null;
  let navigationRequest = 0;
  const feedback = document.createElement("span");
  feedback.className = "pt-code-feedback";
  feedback.setAttribute("role", "status");
  const localChoices = document.createElement("span");
  localChoices.className = "pt-code-choices";
  view.bar.append(feedback, localChoices);

  function startNavigation() {
    closePanel();
    localChoices.replaceChildren();
    feedback.textContent = "";
    return ++navigationRequest;
  }

  function cellAt(element: Element | null) {
    if (!isFullDiff()) return null;
    const cell = element?.closest<HTMLTableCellElement>(".pt-code:not(.pt-void)");
    const row = cell?.closest<HTMLElement>("tr[data-new][data-path]");
    if (!cell || !row || (row.classList.contains("pt-srow") && cell.cellIndex !== 3)) return null;
    return { cell, path: row.dataset.path!, line: row.dataset.new! };
  }

  function lineAt(element: Element | null) {
    const hit = cellAt(element);
    if (!hit) return null;
    const { cell, path, line } = hit;
    return indexedLine(cell, path, line);
  }

  function indexedLine(cell: HTMLElement, path: string, line: string) {
    if (!files) return null;
    const file = Object.hasOwn(files, path) ? files[path] : null;
    const indexed = record(file) ? file[line] : null;
    if (!record(indexed) || typeof indexed.text !== "string" ||
        indexed.text !== cell.textContent || !Array.isArray(indexed.spans)) return null;
    return { cell, text: indexed.text, spans: indexed.spans as unknown[] };
  }

  function symbolAt(line: NonNullable<ReturnType<typeof lineAt>>, column: number): CodeSymbol | null {
    const links: DefinitionLinks = new Map();
    let start = 0;
    let end = Number.POSITIVE_INFINITY;
    for (const span of line.spans) {
      if (!record(span) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
          typeof span.start !== "number" || typeof span.end !== "number" || span.start < 0 ||
          column < span.start || column >= span.end || !Array.isArray(span.targets)) continue;
      for (const target of span.targets) {
        if (!record(target) || !validPath(target.path) || typeof target.line !== "number" ||
            !Number.isSafeInteger(target.line) || target.line < 1 || typeof target.column !== "number" ||
            !Number.isSafeInteger(target.column) || target.column < 0) continue;
        const href = P.permalink(target.path, "new", target.line);
        if (!href) continue;
        const file = files && Object.hasOwn(files, target.path) ? files[target.path] : null;
        const definition = record(file) ? file[target.line] : null;
        const text = record(definition) && typeof definition.text === "string" ? definition.text : undefined;
        links.set(`${href}:${target.column}`, { path: target.path, line: target.line, column: target.column, href, text });
        if (span.end - span.start < end - start) {
          start = span.start;
          end = span.end;
        }
      }
    }
    if (!links.size) return null;
    const bytes = encoder.encode(line.text);
    if (end > bytes.length) return null;
    const before = decoder.decode(bytes.subarray(0, start)).length;
    const name = decoder.decode(bytes.subarray(start, end));
    return { name, links, range: textRange(line.cell, before, before + name.length) };
  }

  function clearHover() {
    hovered?.classList.remove("pt-definition-hit");
    hovered = null;
    CSS.highlights?.delete("pt-definition");
  }

  function closePanel() {
    panelEvents?.abort();
    panelEvents = null;
    panel?.close();
    panel?.remove();
    panel = null;
  }

  async function jumpInDiff(cell: HTMLElement, target: Definition) {
    const request = startNavigation();
    const line = await view.revealDefinition(cell, target.line);
    if (request !== navigationRequest || !cell.isConnected) return;
    if (line) {
      clearHover();
      flashCenter(line);
    } else {
      feedback.textContent = `Could not reveal line ${target.line}`;
    }
  }

  function showLocation(origin: { cell: HTMLElement; path: string }, target: Definition) {
    if (target.path === origin.path) {
      void jumpInDiff(origin.cell, target);
      return;
    }
    closePanel();
    openDefinitionFile(P, target, (cell, path, line, column) => {
      const indexed = indexedLine(cell, path, String(line));
      return indexed && symbolAt(indexed, column);
    }, makeReferenceResults);
  }

  function makeReferenceResults(symbol: CodeSymbol, open: (location: Definition) => void) {
    const snapshot = files;
    const query = async (definition: Definition, isOpen: () => boolean) => {
      const key = `${definition.href}:${definition.column}`;
      const hit = recentReferences.get(key);
      if (hit) {
        recentReferences.delete(key);
        recentReferences.set(key, hit);
        return hit;
      }
      if (!snapshot) return new Map<string, Reference[]>();
      const groups = await referencesTo(snapshot, definition, isOpen);
      if (groups && snapshot === files && [...groups.values()].reduce((n, refs) => n + refs.length, 0) <= 5000) {
        if (recentReferences.size >= 12) recentReferences.delete(recentReferences.keys().next().value!);
        recentReferences.set(key, groups);
      }
      return groups;
    };
    return referenceResults(symbol, query, (ref) => {
      const href = P.permalink(ref.path, "new", ref.line);
      if (href) open({ ...ref, href });
    });
  }

  function findReferences(symbol: CodeSymbol, origin: { cell: HTMLElement; path: string }, point: { x: number; y: number }) {
    startNavigation();
    const results = makeReferenceResults(symbol, (location) => showLocation(origin, location));
    showPanel(symbol.name, point, results, "Find references");
  }

  function navigate(
    symbol: CodeSymbol,
    origin: { cell: HTMLElement; path: string },
    point: { x: number; y: number },
    direct: boolean,
  ) {
    startNavigation();
    if (symbol.links.size === 1) {
      const target = symbol.links.values().next().value!;
      if (target.path === origin.path) {
        void jumpInDiff(origin.cell, target);
        return;
      }
      if (direct) {
        window.open(target.href, "_blank", "noopener");
        return;
      }
    }
    if ([...symbol.links.values()].every((target) => target.path === origin.path)) {
      feedback.textContent = "Choose a definition";
      for (const target of symbol.links.values()) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.textContent = `Line ${target.line}`;
        choice.addEventListener("click", () => { void jumpInDiff(origin.cell, target); });
        localChoices.append(choice);
      }
      localChoices.querySelector("button")?.focus();
      return;
    }
    const list = document.createElement("ul");
    for (const target of symbol.links.values()) {
      const item = document.createElement("li");
      const actions = document.createElement("div");
      actions.className = "pt-definition-actions";
      const viewFile = document.createElement("button");
      viewFile.type = "button";
      viewFile.className = "pt-definition-view";
      viewFile.textContent = `${target.path}:${target.line}`;
      viewFile.title = "View file in Patchtree";
      viewFile.addEventListener("click", () => showLocation(origin, target));
      const link = document.createElement("a");
      link.className = "pt-hbtn";
      link.innerHTML = icons.external;
      const host = P.kind === "github" ? "GitHub" : "GitLab";
      link.title = `Open on ${host}`;
      link.setAttribute("aria-label", `Open ${target.path}:${target.line} on ${host}`);
      link.href = target.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.addEventListener("click", closePanel);
      actions.append(viewFile, link);
      item.append(actions);
      if (target.text?.trim()) {
        const preview = document.createElement("pre");
        preview.textContent = target.text.trim();
        item.append(preview);
        void highlightSource(target.path, [preview]);
      }
      list.append(item);
    }
    const find = document.createElement("button");
    find.type = "button";
    find.className = "pt-reference-action";
    find.textContent = "Find references";
    find.addEventListener("click", () => findReferences(symbol, origin, point));
    const content = document.createElement("div");
    content.append(list, find);
    showPanel(symbol.name, point, content);
  }

  function showPanel(name: string, point: { x: number; y: number }, content: HTMLElement, label = "Go to definition") {
    closePanel();
    const dialog = document.createElement("dialog");
    dialog.className = "pt-definition-panel";
    dialog.setAttribute("aria-label", label);
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = name;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "pt-hbtn";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closePanel);
    header.append(title, close);

    dialog.append(header, content);
    document.body.append(dialog);
    dialog.show();
    panel = dialog;
    const place = () => {
      const { width, height } = dialog.getBoundingClientRect();
      const x = Math.max(8, Math.min(point.x, window.innerWidth - width - 8));
      const y = Math.max(8, point.y + height + 12 < window.innerHeight
        ? point.y + 6 : point.y - height - 16);
      dialog.style.left = `${x}px`;
      dialog.style.top = `${y}px`;
    };
    place();
    content.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });

    panelEvents = new AbortController();
    const { signal } = panelEvents;
    const resize = new ResizeObserver(place);
    resize.observe(dialog);
    signal.addEventListener("abort", () => resize.disconnect(), { once: true });
    document.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Node) || !dialog.contains(event.target)) closePanel();
    }, { signal });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
      }
    }, { signal, capture: true });
    window.addEventListener("resize", closePanel, { signal });
    return dialog;
  }

  view.root.addEventListener("pointermove", (event) => {
    const line = lineAt(event.target instanceof Element ? event.target : null);
    const column = line ? byteColumn(line.cell, event) : null;
    const symbol = line && column !== null ? symbolAt(line, column) : null;
    if (!line || !symbol) {
      if (hovered) clearHover();
      return;
    }
    if (hovered !== line.cell) {
      clearHover();
      hovered = line.cell;
      hovered.classList.add("pt-definition-hit");
    }
    if (symbol.range && typeof Highlight !== "undefined")
      CSS.highlights?.set("pt-definition", new Highlight(symbol.range));
  });
  view.root.addEventListener("pointerleave", clearHover);

  function activate(
    hit: NonNullable<ReturnType<typeof cellAt>>, column: number, point: { x: number; y: number },
    action: "definition" | "direct" | "references", element: Element | null,
  ) {
    const open = (symbol: CodeSymbol, anchor: typeof point, direct = false) => {
      if (action === "references") findReferences(symbol, hit, anchor);
      else navigate(symbol, hit, anchor, direct);
    };
    const line = lineAt(hit.cell);
    const symbol = line && symbolAt(line, column);
    if (symbol) {
      const box = symbol.range?.getBoundingClientRect();
      open(symbol, { x: box?.left ?? point.x, y: box?.bottom ?? point.y }, action === "direct");
      return true;
    }
    const language = indexLanguage(hit.path);
    const index = language && indexers.get(language);
    const alreadyIndexed = language && (imported || indexed.has(language));
    if (!language || !index || (alreadyIndexed && action === "references") ||
        element?.closest(".pt-comment, .pt-string, .pt-keyword, .pt-number")) return false;

    const text = hit.cell.textContent ?? "";
    const offset = decoder.decode(encoder.encode(text).subarray(0, column)).length;
    const word = [...text.matchAll(/[\p{L}_][\p{L}\p{Nd}_]*/gu)]
      .find((word) => word.index <= offset && offset < word.index + word[0].length);
    if (!word || word[0] === "_") return false;
    const anchorAtWord = () => {
      const box = textRange(hit.cell, word.index, word.index + word[0].length)?.getBoundingClientRect();
      return { x: box?.left ?? point.x, y: box?.bottom ?? point.y };
    };
    const request = startNavigation();
    const missing = () => indexed.get(language)?.length
      ? "No indexed definition for this symbol. See Code index limitations in Settings."
      : "No indexed definition for this symbol";
    feedback.textContent = alreadyIndexed ? missing() : `Indexing ${indexLabels[language]}…`;
    if (alreadyIndexed) return true;
    void index()
      .then(() => {
        if (request !== navigationRequest || !hit.cell.isConnected) return;
        const indexed = lineAt(hit.cell);
        const target = indexed && symbolAt(indexed, column);
        if (target) open(target, anchorAtWord());
        else feedback.textContent = missing();
      })
      .catch((error) => {
        if (request === navigationRequest)
          feedback.textContent = error instanceof Error ? error.message : "Could not index repository";
      });
    return true;
  }

  function activatePointer(event: MouseEvent, action: "definition" | "direct" | "references") {
    const element = event.target instanceof Element ? event.target : null;
    const hit = cellAt(element);
    const column = hit ? byteColumn(hit.cell, event) : null;
    if (hit && column !== null && activate(hit, column, { x: event.clientX, y: event.clientY }, action, element))
      event.preventDefault();
  }

  view.root.addEventListener("click", (event) => {
    if (event.button !== 0 || event.shiftKey || event.altKey || !window.getSelection()?.isCollapsed) return;
    activatePointer(event, event.ctrlKey || event.metaKey ? "direct" : "definition");
  });
  view.root.addEventListener("contextmenu", (event) => activatePointer(event, "references"));

  document.addEventListener("keydown", (event) => {
    const references = isReferencesShortcut(event);
    if (event.defaultPrevented || (!references && (event.key !== "Enter" || !(event.ctrlKey || event.metaKey))) ||
        (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable], dialog"))) return;
    const selection = window.getSelection();
    const node = selection?.focusNode;
    const element = node instanceof Element ? node : node?.parentElement ?? null;
    const hit = cellAt(element);
    if (!selection || !node || !hit || !view.root.contains(node)) return;
    const column = caretColumn(hit.cell, selection);
    if (column === null) return;
    const box = hit.cell.getBoundingClientRect();
    if (activate(hit, column, { x: box.left, y: box.bottom }, references ? "references" : "definition", element))
      event.preventDefault();
  });
}

function openDefinitionFile(
  P: Provider,
  target: Definition,
  symbolAt: (cell: HTMLElement, path: string, line: number, column: number) => CodeSymbol | null,
  makeReferenceResults: (symbol: CodeSymbol, open: (target: Definition) => void) => HTMLElement,
) {
  const history = [{ target, top: undefined as number | undefined, left: 0 }];
  let request = 0;
  let source: HTMLElement | undefined;
  let sourcePath: string | undefined;
  const dialog = document.createElement("dialog");
  dialog.className = "pt-definition-file";
  dialog.setAttribute("aria-labelledby", "pt-definition-file-title");
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.id = "pt-definition-file-title";
  const location = document.createElement("span");
  const external = document.createElement("a");
  external.className = "pt-hbtn";
  external.innerHTML = icons.external;
  external.target = "_blank";
  external.rel = "noopener";
  external.title = P.kind === "github" ? "Open on GitHub" : "Open on GitLab";
  external.setAttribute("aria-label", external.title);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pt-hbtn";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close file");
  close.autofocus = true;
  close.addEventListener("click", () => dialog.close());
  const back = document.createElement("button");
  back.type = "button";
  back.className = "pt-hbtn";
  back.innerHTML = icons.arrowLeft;
  back.title = "Go back (Alt+Left)";
  back.setAttribute("aria-label", "Go back");
  back.addEventListener("click", goBack);
  header.append(back, title, location, external, close);
  const choices = document.createElement("div");
  choices.className = "pt-definition-choices";
  choices.hidden = true;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  dialog.append(header, choices, status);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      goBack();
    } else if (event.key === "Escape" && !choices.hidden) {
      event.preventDefault();
      clearChoices();
    } else if (isReferencesShortcut(event) || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
      const selection = window.getSelection();
      const node = selection?.focusNode;
      const cell = node?.parentElement?.closest("code");
      if (!selection || !node || !cell || !source?.contains(cell)) return;
      const column = caretColumn(cell, selection);
      if (column !== null && followAt(cell, column, isReferencesShortcut(event))) event.preventDefault();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  void renderFile();

  function clearChoices() {
    choices.hidden = true;
    choices.replaceChildren();
  }

  function goBack() {
    if (history.length === 1) {
      dialog.close();
      return;
    }
    history.pop();
    void renderFile();
  }

  function follow(target: Definition) {
    const current = history[history.length - 1];
    if (target.href === current.target.href && target.column === current.target.column) {
      clearChoices();
      return;
    }
    current.top = source?.scrollTop;
    current.left = source?.scrollLeft ?? 0;
    history.push({ target, top: undefined, left: 0 });
    void renderFile();
  }

  function followAt(cell: HTMLElement, column: number, references = false) {
    const current = history[history.length - 1];
    const symbol = symbolAt(cell, current.target.path, Number(cell.dataset.line), column);
    clearChoices();
    if (!symbol) return false;
    if (references) {
      choices.append(makeReferenceResults(symbol, follow));
      choices.hidden = false;
      choices.querySelector("button")?.focus();
      return true;
    }
    if (symbol.links.size === 1) {
      follow(symbol.links.values().next().value!);
      return true;
    }
    for (const definition of symbol.links.values()) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = `${definition.path}:${definition.line}`;
      option.addEventListener("click", () => follow(definition));
      choices.append(option);
    }
    choices.hidden = false;
    choices.querySelector("button")?.focus();
    return true;
  }

  function centerDefinition(body: HTMLElement, frame: typeof history[number]) {
    const selected = body.querySelector(`code[data-line="${frame.target.line}"]`)?.parentElement;
    if (!selected) return;
    const previous = body.querySelector(".pt-definition-current-line");
    previous?.classList.remove("pt-definition-current-line");
    previous?.removeAttribute("aria-current");
    selected.classList.add("pt-definition-current-line");
    selected.setAttribute("aria-current", "location");
    body.scrollTop = frame.top ?? selected.offsetTop - (body.clientHeight - selected.offsetHeight) / 2;
    body.scrollLeft = frame.left;
    body.focus({ preventScroll: true });
  }

  async function renderFile() {
    const id = ++request;
    const frame = history[history.length - 1];
    const { target } = frame;
    clearChoices();
    title.textContent = target.path;
    location.textContent = `L${target.line}`;
    external.href = target.href;
    if (source && sourcePath === target.path) {
      centerDefinition(source, frame);
      return;
    }
    source?.remove();
    source = undefined;
    status.textContent = "Loading file…";
    dialog.append(status);
    try {
      const lines = await P.fetchFile(target.path);
      if (!dialog.open || id !== request) return;
      if (lines.length < target.line) throw new Error("The definition line is outside the file");
      const body = document.createElement("div");
      body.className = "pt-definition-source";
      body.tabIndex = 0;
      body.setAttribute("aria-label", "File contents");
      const code = lines.map((line, i) => {
        const row = document.createElement("div");
        const number = document.createElement("span");
        number.className = "pt-definition-line-number";
        number.textContent = String(i + 1);
        number.setAttribute("aria-hidden", "true");
        const text = document.createElement("code");
        text.dataset.line = String(i + 1);
        text.textContent = line.replace(/\r$/, "");
        row.append(number, text);
        body.append(row);
        return text;
      });
      body.addEventListener("click", (event) => {
        if (event.button !== 0 || event.shiftKey || event.altKey || !window.getSelection()?.isCollapsed) return;
        const cell = (event.target as Element).closest("code");
        if (!cell) return;
        const column = byteColumn(cell, event);
        if (column !== null) followAt(cell, column);
      });
      body.addEventListener("contextmenu", (event) => {
        const cell = (event.target as Element).closest("code");
        const column = cell ? byteColumn(cell, event) : null;
        if (cell && column !== null && followAt(cell, column, true)) event.preventDefault();
      });
      let hovered: HTMLElement | undefined;
      body.addEventListener("pointermove", (event) => {
        const cell = (event.target as Element).closest("code");
        const column = cell ? byteColumn(cell, event) : null;
        const symbol = cell && column !== null
          ? symbolAt(cell, target.path, Number(cell.dataset.line), column) : undefined;
        hovered?.classList.remove("pt-definition-hit");
        hovered = symbol ? cell! : undefined;
        hovered?.classList.add("pt-definition-hit");
      });
      body.addEventListener("pointerleave", () => hovered?.classList.remove("pt-definition-hit"));
      status.replaceWith(body);
      source = body;
      sourcePath = target.path;
      centerDefinition(body, frame);
      void highlightSource(target.path, code);
    } catch (error) {
      if (!dialog.open || id !== request) return;
      status.textContent = error instanceof Error ? `Could not open file (${error.message})` : "Could not open file";
    }
  }
}

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function referencesTo(files: Record<string, unknown>, definition: Definition, isOpen: () => boolean) {
  const references = new Map<string, Reference[]>();
  let deadline = performance.now() + 8;
  let scanned = 0;
  for (const path of Object.keys(files).sort()) {
    const rows = files[path];
    if (!validPath(path) || !record(rows)) continue;
    for (const [lineNumber, row] of Object.entries(rows)) {
      const line = Number(lineNumber);
      if (!Number.isSafeInteger(line) || line < 1 || !record(row) ||
          typeof row.text !== "string" || !Array.isArray(row.spans)) continue;
      let columns: Set<number> | undefined;
      for (const span of row.spans) {
        if (++scanned % 128 === 0 && performance.now() >= deadline) {
          await yieldToUI();
          if (!isOpen()) return;
          deadline = performance.now() + 8;
        }
        if (!record(span) || typeof span.start !== "number" || typeof span.end !== "number" ||
            !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
            span.start < 0 || span.end <= span.start || !Array.isArray(span.targets) ||
            columns?.has(span.start)) continue;
        let matches = false;
        let declaration = false;
        for (const target of span.targets) {
          if (!record(target)) continue;
          if (target.path === definition.path && target.line === definition.line && target.column === definition.column)
            matches = true;
          if (target.path === path && target.line === line && target.column === span.start)
            declaration = true;
        }
        if (!matches || declaration) continue;
        (columns ??= new Set()).add(span.start);
        const ref = { path, line, column: span.start, end: span.end, text: row.text };
        let group = references.get(path);
        if (!group) references.set(path, group = []);
        group.push(ref);
      }
    }
  }
  return references;
}

function referenceResults(
  symbol: CodeSymbol,
  query: (definition: Definition, isOpen: () => boolean) => Promise<ReferenceGroups | undefined>,
  open: (ref: Reference) => void,
) {
  const results = document.createElement("div");
  results.className = "pt-reference-results";
  results.setAttribute("role", "region");
  results.setAttribute("aria-label", `References for ${symbol.name}`);

  async function render(definition: Definition) {
    const summary = document.createElement("p");
    summary.className = "pt-reference-summary";
    summary.setAttribute("role", "status");
    summary.textContent = "Finding references…";
    results.replaceChildren(summary);
    await yieldToUI();
    if (!results.isConnected) return;
    const groups = await query(definition, () => results.isConnected);
    if (!groups || !results.isConnected) return;
    const count = [...groups.values()].reduce((sum, refs) => sum + refs.length, 0);
    summary.textContent = count ? `${count} ${count === 1 ? "reference" : "references"}` : "No indexed references";
    const rows = referenceRows(groups);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "pt-reference-action";
    more.textContent = "Show more references";
    more.addEventListener("click", () => appendPage());
    results.append(more);
    let group: HTMLElement | undefined;
    let prevPath: string | undefined;
    let shown = 0;
    appendPage();

    function appendPage() {
      const end = Math.min(shown + 100, count);
      while (shown < end) {
        const ref = rows.next().value!;
        if (ref.path !== prevPath) {
          group = document.createElement("div");
          group.className = "pt-reference-group";
          const heading = document.createElement("strong");
          heading.textContent = ref.path;
          group.append(heading);
          more.before(group);
          prevPath = ref.path;
        }
        group!.append(referenceButton(ref));
        shown++;
      }
      more.hidden = shown === count;
    }
  }

  function* referenceRows(groups: ReferenceGroups) {
    for (const refs of groups.values())
      yield* refs.sort((a, b) => a.line - b.line || a.column - b.column);
  }

  function referenceButton(ref: Reference) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "pt-reference-row";
    item.setAttribute("aria-label", `${ref.path}:${ref.line}:${ref.column + 1}`);
    const line = document.createElement("span");
    line.textContent = String(ref.line);
    const snippet = document.createElement("code");
    const text = encoder.encode(ref.text);
    const before = decoder.decode(text.subarray(0, ref.column)).trimStart();
    const after = decoder.decode(text.subarray(ref.end, ref.end + 100));
    const match = document.createElement("mark");
    match.textContent = decoder.decode(text.subarray(ref.column, ref.end));
    snippet.append(before.length > 48 ? `…${before.slice(-48)}` : before, match, after);
    item.append(line, snippet);
    item.addEventListener("click", () => open(ref));
    return item;
  }

  if (symbol.links.size === 1) {
    void render(symbol.links.values().next().value!);
  } else {
    const prompt = document.createElement("p");
    prompt.className = "pt-reference-summary";
    prompt.textContent = "Choose a definition to find its references";
    results.append(prompt);
    for (const target of symbol.links.values()) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "pt-reference-action";
      choice.textContent = `${target.path}:${target.line}:${target.column + 1}`;
      choice.addEventListener("click", () => {
        void render(target);
      });
      results.append(choice);
    }
  }
  return results;
}

async function unpackIndex(reply: { index: string; gzip?: boolean }): Promise<unknown> {
  if (!reply.gzip) return JSON.parse(reply.index);
  const bytes = Uint8Array.from(atob(reply.index), (char) => char.charCodeAt(0));
  const raw = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(raw).json();
}

async function highlightSource(path: string, lines: HTMLElement[]) {
  const text = lines.map((line) => line.textContent ?? "").join("\n");
  const lang = text.length <= 300 * 1024 ? resolveLang(path, text) : null;
  if (!lang) return;
  const result = await chrome.runtime.sendMessage({ type: "highlight", lang, text })
    .catch(() => null) as { rows?: Record<string, HighlightRange[]> } | null;
  const selection = window.getSelection();
  for (const [row, ranges] of Object.entries(result?.rows ?? {})) {
    const line = lines[Number(row)];
    // Highlighting arrives asynchronously and must preserve the user's caret.
    if (line?.isConnected && !line.contains(selection?.anchorNode ?? null) && !line.contains(selection?.focusNode ?? null))
      line.innerHTML = renderLineHTML(line.textContent!, ranges, null);
  }
}

function textRange(cell: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let range: Range | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const size = node.textContent!.length;
    if (!range && start < offset + size) {
      range = document.createRange();
      range.setStart(node, start - offset);
    }
    if (range && end <= offset + size) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += size;
  }
  return undefined;
}
