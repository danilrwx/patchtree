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

// Stateful variant for the write path: starts with no threads, records posted
// review comments and reflects them back through the GraphQL threads query, so
// a freshly posted comment shows up after refreshThreads().
export async function mockGithubStateful(context: BrowserContext): Promise<void> {
  const posted: { path: string; line: number; side: string; body: string }[] = [];
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });

    if (p === "/graphql") {
      const nodes = posted.map((c, i) => ({
        id: `T${i}`,
        isResolved: false,
        path: c.path,
        line: c.line,
        diffSide: c.side === "LEFT" ? "LEFT" : "RIGHT",
        comments: {
          nodes: [
            {
              databaseId: 1000 + i,
              body: c.body,
              createdAt: "2026-01-01T00:00:00Z",
              author: { login: "me", databaseId: 9 },
            },
          ],
        },
      }));
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } });
    }
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}/comments` && req.method() === "POST") {
      const b = (req.postDataJSON?.() ?? {}) as { path: string; line: number; side: string; body: string };
      posted.push({ path: b.path, line: b.line, side: b.side, body: b.body });
      return json({ id: posted.length, user: { login: "me", id: 9 }, created_at: "t", body: b.body });
    }
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    if (p === "/markdown") {
      const b = (req.postDataJSON?.() ?? {}) as { text?: string };
      return route.fulfill({ contentType: "text/html", body: `<p>${b.text ?? ""}</p>` });
    }
    if (p.includes("/contents/")) {
      const lines = Array.from({ length: 80 }, (_, i) => `\tline ${i + 1}`);
      return route.fulfill({ contentType: "text/plain", body: lines.join("\n") });
    }
    return json([]);
  });
}

// Stateful thread mock for reply/resolve: one seeded resolvable thread whose
// comments and resolved flag mutate, reflected through the GraphQL query.
export async function mockGithubThreads(context: BrowserContext): Promise<void> {
  const thread = {
    resolved: false,
    comments: [{ databaseId: 1001, body: COMMENT_BODY, author: { login: "me", databaseId: 42 } }],
  };
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });

    if (p === "/graphql") {
      const q = req.postData() || "";
      if (q.includes("resolveReviewThread") && !q.includes("unresolve")) thread.resolved = true;
      else if (q.includes("unresolveReviewThread")) thread.resolved = false;
      const node = {
        id: "T1",
        isResolved: thread.resolved,
        path: "pkg/virt-controller/watch/dra/dra.go",
        line: 62,
        diffSide: "RIGHT",
        comments: {
          nodes: thread.comments.map((c) => ({
            databaseId: c.databaseId,
            body: c.body,
            createdAt: "2026-01-01T00:00:00Z",
            author: c.author,
          })),
        },
      };
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [node] } } } } });
    }
    if (/\/comments\/\d+\/replies$/.test(p) && req.method() === "POST") {
      const b = (req.postDataJSON?.() ?? {}) as { body: string };
      const c = { databaseId: 2000 + thread.comments.length, body: b.body, author: { login: "me", databaseId: 42 } };
      thread.comments.push(c);
      return json({ id: c.databaseId, user: { login: "me", id: 42 }, created_at: "t", body: b.body });
    }
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === "/user") return json({ id: 42, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    if (p === "/markdown") {
      const b = (req.postDataJSON?.() ?? {}) as { text?: string };
      return route.fulfill({ contentType: "text/html", body: `<p>${b.text ?? ""}</p>` });
    }
    return json([]);
  });
}

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
    if (p.includes("/contents/")) {
      // raw file for expanders (fetchFile) — 80 lines of filler
      const lines = Array.from({ length: 80 }, (_, i) => `\tline ${i + 1} of the source file`);
      return route.fulfill({ contentType: "text/plain", body: lines.join("\n") });
    }
    // issue comments, commits, reviews → empty
    return json([]);
  });
}
