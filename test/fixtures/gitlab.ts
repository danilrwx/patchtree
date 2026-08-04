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

// Mocks for the GitLab adapter: a self-hosted MR .diff page and the /api/v4
// endpoints the provider touches are fulfilled from fixtures — no network, no
// token. Mirrors the GitHub mock so both adapters get e2e coverage.
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PROJECT = "group/proj";
export const IID = 104;
export const HOST = "https://gitlab.example.com";
export const TOKEN_HOST = "gitlab.example.com";
export const DIFF_URL = `${HOST}/${PROJECT}/-/merge_requests/${IID}.diff`;

const HEAD = "1111111111111111111111111111111111111111";
const BASE = "2222222222222222222222222222222222222222";

export const COMMENT_BODY = "patchtree-e2e-gitlab: is the nil claim path covered?";

const diff = readFileSync(path.join(__dirname, "pr130.diff"), "utf8");

const discussions = [
  {
    id: "disc_1",
    notes: [
      {
        id: 501,
        system: false,
        resolvable: true,
        resolved: false,
        position: {
          position_type: "text",
          new_path: "pkg/virt-controller/watch/dra/dra.go",
          old_path: "pkg/virt-controller/watch/dra/dra.go",
          new_line: 62,
          old_line: null,
        },
        author: { name: "Reviewer", id: 7 },
        created_at: "2026-01-01T00:00:00Z",
        body: COMMENT_BODY,
        suggestions: null,
      },
    ],
  },
];

const mr = {
  title: "fix dra nil handling",
  diff_refs: { head_sha: HEAD, base_sha: BASE, start_sha: BASE },
  source_branch: "feature",
  target_branch: "main",
  head_pipeline: { status: "success", web_url: `${HOST}/pipe` },
  web_url: `${HOST}/${PROJECT}/-/merge_requests/${IID}`,
  has_conflicts: false,
};

const DRAFT_BODY = "patchtree-e2e-gitlab: draft note pending review";
export { DRAFT_BODY };

// Stateful GitLab mock for the draft-review flow (a GitLab-only capability):
// draft notes can be created, discarded, and published. With `seedDraft` a
// pending draft is present on load so discard/publish have something to act on.
export async function mockGitlabStateful(
  context: BrowserContext,
  opts: { seedDraft?: boolean } = {}
): Promise<void> {
  const draftPos = {
    position_type: "text",
    new_path: "pkg/virt-controller/watch/dra/dra.go",
    old_path: "pkg/virt-controller/watch/dra/dra.go",
    new_line: 62,
    old_line: null,
  };
  const drafts: any[] = opts.seedDraft
    ? [{ id: 900, note: DRAFT_BODY, position: draftPos }]
    : [];
  let nextId = 901;

  await context.route(`${DIFF_URL}*`, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await context.route(`${HOST}/api/**`, (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    const base = `/merge_requests/${IID}`;

    if (p.includes(`${base}/draft_notes/bulk_publish`)) {
      // GitLab only accepts POST here; any other verb is routed to
      // /draft_notes/:draft_note_id and fails on the non-numeric id
      if (req.method() !== "POST")
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "draft_note_id is invalid" }),
        });
      drafts.length = 0;
      return json({});
    }
    const delM = /\/draft_notes\/(\d+)$/.exec(p);
    if (delM && req.method() === "DELETE") {
      const i = drafts.findIndex((d) => String(d.id) === delM[1]);
      if (i >= 0) drafts.splice(i, 1);
      return route.fulfill({ status: 204, body: "" });
    }
    if (p.includes(`${base}/draft_notes`)) {
      if (req.method() === "POST") {
        const b = (req.postDataJSON?.() ?? {}) as { note: string };
        const d = { id: nextId++, note: b.note, position: draftPos };
        drafts.push(d);
        return json(d);
      }
      return json(drafts);
    }
    if (p.includes(`${base}/discussions`)) return json([]);
    if (p.includes(`${base}/approvals`)) return json({ approved_by: [] });
    if (p.includes(`${base}/commits`)) return json([]);
    if (p.endsWith(base)) return json(mr);
    if (p.endsWith("/api/v4/user")) return json({ id: 9, name: "Me" });
    if (p.endsWith("/api/v4/markdown")) {
      const body = (req.postDataJSON?.() ?? {}) as { text?: string };
      return json({ html: `<p>${body.text ?? ""}</p>` });
    }
    if (p.endsWith("/api/graphql")) return json({ data: {} });
    return json([]);
  });
}

// distinct single-file diffs so a commit pick / whitespace toggle is observable
const commitDiff = `diff --git a/commit_only.go b/commit_only.go
index 1111111..2222222 100644
--- a/commit_only.go
+++ b/commit_only.go
@@ -1,2 +1,2 @@
 package main
-var x = 1
+var x = 2
`;
const wsDiff = `diff --git a/whitespace_clean.go b/whitespace_clean.go
index 3333333..4444444 100644
--- a/whitespace_clean.go
+++ b/whitespace_clean.go
@@ -1,2 +1,2 @@
 package main
-var y = 1
+var y = 2
`;

// GitLab-only extras: the commit selector (commitDiff is a direct page fetch)
// and the ignore-whitespace toggle (?w=1 re-fetch). Both re-render the diff.
export async function mockGitlabExtras(context: BrowserContext): Promise<void> {
  const commits = [{ id: "c0ffee0", short_id: "c0ffee0", title: "isolated commit change" }];

  await context.route(`${DIFF_URL}*`, (route) => {
    const body = route.request().url().includes("w=1") ? wsDiff : diff;
    return route.fulfill({ contentType: "text/plain; charset=utf-8", body });
  });
  await context.route(`${HOST}/${PROJECT}/-/commit/*`, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: commitDiff })
  );
  await context.route(`${HOST}/api/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    const base = `/merge_requests/${IID}`;
    if (p.includes(`${base}/discussions`)) return json([]);
    if (p.includes(`${base}/draft_notes`)) return json([]);
    if (p.includes(`${base}/approvals`)) return json({ approved_by: [] });
    if (p.includes(`${base}/commits`)) return json(commits);
    if (p.endsWith(base)) return json(mr);
    if (p.endsWith("/api/v4/user")) return json({ id: 9, name: "Me" });
    if (p.endsWith("/api/v4/markdown")) return json({ html: "<p></p>" });
    if (p.endsWith("/api/graphql")) return json({ data: {} });
    return json([]);
  });
}

export async function mockGitlab(context: BrowserContext): Promise<void> {
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );

  await context.route(`${HOST}/api/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    const base = `/merge_requests/${IID}`;

    if (p.includes(`${base}/discussions`)) return json(discussions);
    if (p.includes(`${base}/draft_notes`)) return json([]);
    if (p.includes(`${base}/approvals`)) return json({ approved_by: [] });
    if (p.includes(`${base}/commits`)) return json([]);
    if (p.endsWith(base)) return json(mr);
    if (p.endsWith("/api/v4/user")) return json({ id: 7, name: "Reviewer" });
    if (p.endsWith("/api/v4/markdown")) {
      const body = (route.request().postDataJSON?.() ?? {}) as { text?: string };
      return json({ html: `<p>${body.text ?? ""}</p>` });
    }
    if (p.endsWith("/api/graphql")) return json({ data: {} });
    return json([]);
  });
}
