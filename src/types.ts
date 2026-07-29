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

// The normalized review contract shared by both providers and consumed by the
// diff/review UI. GitLab- and GitHub-specific API shapes are intentionally left
// as `any` at the network boundary; only these normalized shapes are typed.

export type Side = "old" | "new";

export interface Capabilities {
  resolve: boolean;
  drafts: boolean;
  applySuggestion: boolean;
  whitespace: boolean;
}

export interface Refs {
  baseSha: string;
  startSha: string;
  headSha: string;
}

export interface Me {
  id: number;
  name: string;
}

export interface CiStatus {
  state: string;
  url: string;
}

export interface Info {
  title: string;
  headSha?: string;
  baseSha?: string;
  startSha?: string;
  ci: CiStatus | null;
  conflicts: boolean;
}

export interface Commit {
  sha: string;
  short: string;
  title: string;
}

export type NoteKind = "line" | "issue";

export interface Note {
  id: number | string;
  kind: NoteKind;
  author: string;
  authorId?: number | string;
  createdAt: string;
  body: string;
  resolved: boolean;
  suggestions: unknown[] | null;
}

export interface ThreadPos {
  path: string;
  oldPath: string;
  side: Side;
  oldLine: number | null;
  newLine: number | null;
}

export interface Thread {
  id: number | string;
  general: boolean;
  resolvable: boolean;
  resolved: boolean;
  pos: ThreadPos | null;
  notes: Note[];
  // GitHub carries the databaseId of the root comment to reply to
  replyToId?: number | string;
}

export interface Draft {
  id: number | string;
  body: string;
  pos?: ThreadPos | null;
}

export type ReviewAction = "approve" | "unapprove" | "request" | "comment" | "";

export interface ReviewInput {
  body: string;
  action: ReviewAction;
}

// One end of a comment anchor, as built from the diff table. Carries both the
// resolved line numbers (old/new) and GitLab's per-line codes for line_range.
export interface AnchorEnd {
  codeOld: string;
  codeNew: string;
  old: number;
  new: number;
}

// The line a new comment/draft is anchored to. `end*` are the single-line
// numbers; start/end are only present for multiline ranges.
export interface LineAnchor {
  path: string;
  oldPath?: string;
  side: Side;
  ctx?: boolean;
  endOld?: number;
  endNew?: number;
  multiline?: boolean;
  start?: AnchorEnd;
  end?: AnchorEnd;
}

// Suggestion apply payload. GitLab needs only `id`; GitHub commits the
// replacement and uses path/startLine/endLine/text.
export interface SuggestionApply {
  id?: number | string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface Provider {
  kind: "gitlab" | "github";
  can: Capabilities;
  token: string | null;
  tokenHint: string;
  setRefs(refs: Refs): void;
  init(): Promise<void>;
  me(): Promise<Me>;
  info(): Promise<Info>;
  threads(): Promise<Thread[]>;
  postThread(anchor: LineAnchor, body: string): Promise<Note[]>;
  reply(thread: Thread, body: string): Promise<Note>;
  editNote(note: Note, body: string): Promise<string>;
  deleteNote(note: Note): Promise<unknown>;
  resolveThread(thread: Thread, resolved: boolean): Promise<unknown>;
  review(input: ReviewInput): Promise<void>;
  approvedByMe(meId?: number): Promise<boolean>;
  commits(): Promise<Commit[]>;
  commitDiff(sha: string): Promise<string>;
  fetchFile(path: string): Promise<string[]>;
  markdown(text: string): Promise<string>;
  permalink(path: string, side: Side, line: number): string | null;
  blobUrl(path: string): string | null;
  applySuggestion(desc: SuggestionApply): Promise<unknown>;
  // GitLab-only (gated by can.whitespace / can.drafts)
  whitespaceDiff?(): Promise<string>;
  drafts?(): Promise<Draft[]>;
  postDraft?(anchor: LineAnchor, body: string, replyTo?: string): Promise<{ id: number | string; body: string }>;
  deleteDraft?(draft: Draft): Promise<unknown>;
  publishDrafts?(): Promise<unknown>;
}
