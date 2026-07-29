// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Mocks for the GitLab adapter: a self-hosted MR .diff page and the /api/v4
// endpoints the provider touches are fulfilled from fixtures — no network, no
// token. Mirrors the GitHub mock so both adapters get e2e coverage.
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PROJECT = "group/proj";
export const IID = 104;
export const HOST = "https://gitlab.example.com";
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
  head_pipeline: { status: "success", web_url: `${HOST}/pipe` },
  has_conflicts: false,
};

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
