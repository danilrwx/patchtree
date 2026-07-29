// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Mocks for the GitHub adapter: the PR .diff page and every api.github.com
// endpoint the provider touches are fulfilled from fixtures, so the e2e tests
// exercise the real content script + highlighter with no network or token.
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

export const OWNER = "deckhouse";
export const REPO = "3p-kubevirt";
export const NUM = 130;
export const DIFF_URL = `https://github.com/${OWNER}/${REPO}/pull/${NUM}.diff`;

const HEAD = "1111111111111111111111111111111111111111";
const BASE = "2222222222222222222222222222222222222222";

// asserted verbatim in the rendered DOM
export const COMMENT_BODY = "patchtree-e2e: does this branch handle a nil claim?";

const diff = readFileSync(path.join(__dirname, "pr130.diff"), "utf8");

// one resolved-review-thread on a line that exists in the first hunk
// (@@ -60,9 +60,14 @@ → new side line 62 is rendered)
const threadsGql = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              id: "THREAD_1",
              isResolved: false,
              path: "pkg/virt-controller/watch/dra/dra.go",
              line: 62,
              diffSide: "RIGHT",
              comments: {
                nodes: [
                  {
                    databaseId: 1001,
                    body: COMMENT_BODY,
                    createdAt: "2026-01-01T00:00:00Z",
                    author: { login: "reviewer", databaseId: 42 },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

// no-token path: threads() falls back to the REST pull comments endpoint
const restComments = [
  {
    id: 1001,
    in_reply_to_id: null,
    path: "pkg/virt-controller/watch/dra/dra.go",
    line: 62,
    side: "RIGHT",
    body: COMMENT_BODY,
    user: { login: "reviewer", id: 42 },
    created_at: "2026-01-01T00:00:00Z",
  },
];

const pull = {
  title: "fix dra nil handling",
  number: NUM,
  head: { sha: HEAD, ref: "feature", repo: { full_name: `${OWNER}/${REPO}` } },
  base: { sha: BASE },
  mergeable: true,
};

export async function mockGithub(context: BrowserContext): Promise<void> {
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );

  await context.route("https://api.github.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });

    if (p === "/graphql") return json(threadsGql);
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}/comments`) return json(restComments);
    if (p === "/user") return json({ id: 42, login: "reviewer" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    if (p === "/markdown") {
      // note bodies are rendered through GitHub's markdown API (text/html)
      const body = (route.request().postDataJSON?.() ?? {}) as { text?: string };
      return route.fulfill({ contentType: "text/html", body: `<p>${body.text ?? ""}</p>` });
    }
    // issue comments, commits, reviews → empty
    return json([]);
  });
}
