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
const manyDiff = readFileSync(path.join(__dirname, "manyfiles.diff"), "utf8");

// path of the file the many-file thread anchors to (the 8th file → lazily
// mounted, so jumping to it must trigger its mount first)
export const MANY_THREAD_PATH = "pkg/mod08/file.go";
export const MANY_THREAD_BODY = "patchtree-e2e: thread deep in a lazily-mounted file";

// a 10-file PR with a single unresolved thread in a late (unmounted) file, to
// exercise jump-to-thread scroll into a section whose rows aren't in the DOM yet
export async function mockGithubManyThread(context: BrowserContext): Promise<void> {
  const node = {
    id: "MANY1",
    isResolved: false,
    path: MANY_THREAD_PATH,
    line: 5,
    diffSide: "RIGHT",
    comments: {
      nodes: [
        {
          databaseId: 8001,
          body: MANY_THREAD_BODY,
          createdAt: "2026-01-01T00:00:00Z",
          author: { login: "reviewer", databaseId: 42 },
        },
      ],
    },
  };
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: manyDiff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/graphql")
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [node] } } } } });
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    if (p === "/markdown") {
      const b = (route.request().postDataJSON?.() ?? {}) as { text?: string };
      return route.fulfill({ contentType: "text/html", body: `<p>${b.text ?? ""}</p>` });
    }
    return json([]);
  });
}

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
  base: { sha: BASE, ref: "main" },
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
    const editM = /\/pulls\/comments\/(\d+)$/.exec(p);
    if (editM && req.method() === "PATCH") {
      const b = (req.postDataJSON?.() ?? {}) as { body: string };
      const c = thread.comments.find((c) => String(c.databaseId) === editM[1]);
      if (c) c.body = b.body;
      return json({ id: +editM[1], body: b.body, user: { login: "me", id: 42 }, created_at: "t" });
    }
    if (editM && req.method() === "DELETE") {
      thread.comments = thread.comments.filter((c) => String(c.databaseId) !== editM[1]);
      return route.fulfill({ status: 204, body: "" });
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

// text the suggestion block proposes; asserted in the rendered widget
export const SUGGESTION_TEXT = "e2e suggested replacement";

// one thread whose only comment is a ```suggestion``` block on a rendered line
export async function mockGithubSuggestion(context: BrowserContext): Promise<void> {
  const node = {
    id: "SUG1",
    isResolved: false,
    path: "pkg/virt-controller/watch/dra/dra.go",
    line: 62,
    diffSide: "RIGHT",
    comments: {
      nodes: [
        {
          databaseId: 3001,
          body: `\`\`\`suggestion\n${SUGGESTION_TEXT}\n\`\`\``,
          createdAt: "2026-01-01T00:00:00Z",
          author: { login: "reviewer", databaseId: 7 },
        },
      ],
    },
  };
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/graphql")
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [node] } } } } });
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    if (p === "/markdown") return route.fulfill({ contentType: "text/html", body: "<p></p>" });
    // apply-suggestion commits to the head branch: read the file, then PUT it back
    if (p.includes("/contents/")) {
      if (route.request().method() === "PUT") return json({ commit: {} });
      const text = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n");
      return json({ content: Buffer.from(text).toString("base64"), sha: "filesha" });
    }
    return json([]);
  });
}

// a multi-line GitHub suggestion: a plain ```suggestion fence whose replaced
// range comes from the comment's startLine..line (62..63), not the fence header
export async function mockGithubMultiSuggestion(context: BrowserContext): Promise<void> {
  const node = {
    id: "SUG2",
    isResolved: false,
    path: "pkg/virt-controller/watch/dra/dra.go",
    line: 63,
    startLine: 62,
    diffSide: "RIGHT",
    comments: {
      nodes: [
        {
          databaseId: 3002,
          body: "```suggestion\nfirst replaced\nsecond replaced\n```",
          createdAt: "2026-01-01T00:00:00Z",
          author: { login: "reviewer", databaseId: 7 },
        },
      ],
    },
  };
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/graphql")
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [node] } } } } });
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    if (p === "/markdown") {
      const b = (route.request().postDataJSON?.() ?? {}) as { text?: string };
      return route.fulfill({ contentType: "text/html", body: `<p>${b.text ?? ""}</p>` });
    }
    return json([]);
  });
}

const imageDiff = readFileSync(path.join(__dirname, "image.diff"), "utf8");
// a 1x1 transparent PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// a binary image file change; the contents API returns base64 for old + new refs
export async function mockGithubImage(context: BrowserContext): Promise<void> {
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: imageDiff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/graphql")
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === `/repos/${OWNER}/${REPO}/contents/logo.png`) return json({ content: PNG_B64 });
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    return json([]);
  });
}

const imageAddDiff = readFileSync(path.join(__dirname, "imageadd.diff"), "utf8");

// an added binary image: only the new side has content (no old revision)
export async function mockGithubAddedImage(context: BrowserContext): Promise<void> {
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: imageAddDiff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/graphql")
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === `/repos/${OWNER}/${REPO}/contents/added.png`) return json({ content: PNG_B64 });
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    return json([]);
  });
}

const renameDiff = readFileSync(path.join(__dirname, "rename.diff"), "utf8");

// a diff of pure renames (no line changes); no line threads exist for these
export async function mockGithubRename(context: BrowserContext): Promise<void> {
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: renameDiff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    if (p === "/graphql")
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
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

// body of the seeded general (issue) discussion comment
export const DISCUSSION_BODY = "patchtree-e2e: general PR discussion note";

// a PR with one general (issue) discussion comment and a reply endpoint, for the
// #pt-mr-threads block that renders non-line discussion.
export async function mockGithubDiscussion(context: BrowserContext): Promise<void> {
  const issues = [
    {
      id: 5001,
      body: DISCUSSION_BODY,
      user: { login: "reviewer", id: 42 },
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  await context.route(DIFF_URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await context.route("https://api.github.com/**", (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(o) });

    if (p === "/graphql")
      return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    if (p === `/repos/${OWNER}/${REPO}/pulls/${NUM}`) return json(pull);
    if (p === `/repos/${OWNER}/${REPO}/issues/${NUM}/comments`) {
      if (req.method() === "POST") {
        const b = (req.postDataJSON?.() ?? {}) as { body: string };
        return json({ id: 5002, body: b.body, user: { login: "me", id: 9 }, created_at: "t" });
      }
      return json(issues);
    }
    if (p === "/user") return json({ id: 9, login: "me" });
    if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
    if (p === "/markdown") {
      const b = (req.postDataJSON?.() ?? {}) as { text?: string };
      return route.fulfill({ contentType: "text/html", body: `<p>${b.text ?? ""}</p>` });
    }
    return json([]);
  });
}
