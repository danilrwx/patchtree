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

// Adapter unit tests: load providers.ts with a mocked fetch and a mocked
// storage token, then drive every Provider method and assert the request it
// issues (url, method, auth header, body) and how it normalizes the response.
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
// bundle the providers entry (it now spans index/gitlab/github/shared/diff) into
// a single cjs module we can run in the sandbox
const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL("src/providers/index.ts", root))],
  bundle: true,
  format: "cjs",
  platform: "browser",
  write: false,
  logLevel: "silent",
});
const code = outputFiles[0].text;
const sandboxRequire = (id) => {
  throw new Error(`unexpected require: ${id}`);
};

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// values returned by the provider live in the vm realm, so their prototype
// differs and deepStrictEqual rejects them; compare JSON-normalized (this also
// drops undefined keys).
const same = (actual, expected) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

function resp(body, { status = 200, headers = {}, text } = {}) {
  const lc = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text ?? (typeof body === "string" ? body : JSON.stringify(body)),
    headers: { get: (k) => lc[k.toLowerCase()] ?? null },
  };
}

// build a provider instance with mocked globals; `reply` routes each fetch by
// url and records the calls for assertions.
async function harness({ location, tokenHost, token = "SEKRET", sendMessage } = {}) {
  const calls = [];
  let reply = () => resp(null);
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: sandboxRequire,
    location,
    fetch: async (url, opts = {}) => {
      calls.push({ url, opts, method: opts.method || "GET", body: opts.body, headers: opts.headers });
      return reply(url, opts);
    },
    chrome: {
      storage: {
        local: { get: async () => (tokenHost ? { gitlabs: { [tokenHost]: { token } } } : {}) },
        sync: { get: async () => ({}), remove() {} },
      },
      runtime: { sendMessage: sendMessage || (async () => ({ ok: true, text: "diff" })) },
    },
    crypto: globalThis.crypto,
    TextEncoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    escape: globalThis.escape,
    unescape: globalThis.unescape,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const P = mod.exports.makeProvider();
  await P.init();
  return {
    P,
    calls,
    last: () => calls[calls.length - 1],
    setReply: (fn) => (reply = fn),
    find: (re) => calls.find((c) => re.test(c.url)),
  };
}

const GL_LOC = {
  host: "gitlab.example.com",
  origin: "https://gitlab.example.com",
  pathname: "/group/proj/-/merge_requests/104.diff",
  href: "https://gitlab.example.com/group/proj/-/merge_requests/104.diff",
};
const REFS = { baseSha: "base", startSha: "start", headSha: "head" };

// ---- GitLab ----------------------------------------------------------------

await (async () => {
  const h = await harness({ location: GL_LOC, tokenHost: "gitlab.example.com" });
  const { P } = h;
  P.setRefs(REFS);

  t("gitlab: init loads the token", () => assert.equal(P.token, "SEKRET"));

  {
    h.setReply(() => resp({ id: 5, name: "Alice" }));
    const me = await P.me();
    t("gitlab: me sends PRIVATE-TOKEN and normalizes", () => {
      assert.equal(me.name, "Alice");
      const c = h.last();
      assert.match(c.url, /\/api\/v4\/user$/);
      assert.equal(c.headers["PRIVATE-TOKEN"], "SEKRET");
    });
  }

  {
    h.setReply(() =>
      resp({
        title: "T",
        diff_refs: { head_sha: "H", base_sha: "B", start_sha: "S" },
        head_pipeline: { status: "success", web_url: "u" },
        has_conflicts: true,
      })
    );
    const info = await P.info();
    t("gitlab: info maps diff_refs, ci and conflicts", () => {
      assert.equal(info.title, "!104 T");
      assert.deepEqual([info.headSha, info.baseSha, info.startSha], ["H", "B", "S"]);
      assert.equal(info.ci.state, "success");
      assert.equal(info.conflicts, true);
    });
  }

  {
    h.setReply(() =>
      resp([
        {
          id: "d1",
          notes: [
            {
              id: 1,
              system: false,
              resolvable: true,
              resolved: false,
              position: { position_type: "text", new_path: "f.go", old_path: "f.go", new_line: 9 },
              author: { name: "Bob", id: 2 },
              created_at: "t",
              body: "hi",
            },
          ],
        },
      ])
    );
    const th = await P.threads();
    t("gitlab: threads normalizes discussion into a line thread", () => {
      assert.equal(th.length, 1);
      assert.equal(th[0].resolvable, true);
      assert.equal(th[0].general, false);
      same(th[0].pos, { path: "f.go", oldPath: "f.go", side: "new", newLine: 9 });
      assert.equal(th[0].notes[0].body, "hi");
    });
  }

  {
    h.setReply(() => resp({ notes: [{ id: 7, author: { name: "Me", id: 1 }, created_at: "t", body: "b" }] }));
    await P.postThread({ path: "f.go", side: "new", endNew: 9, endOld: 8 }, "b");
    t("gitlab: postThread posts a text position on the new line", () => {
      const c = h.last();
      assert.match(c.url, /\/discussions$/);
      assert.equal(c.method, "POST");
      const pos = JSON.parse(c.body).position;
      assert.equal(pos.position_type, "text");
      assert.equal(pos.new_line, 9);
      assert.equal(pos.new_path, "f.go");
    });
  }

  {
    h.setReply(() => resp({ id: 8, author: { name: "Me", id: 1 }, created_at: "t", body: "r" }));
    await P.reply({ id: "d1" }, "r");
    t("gitlab: reply hits the discussion notes endpoint", () => {
      assert.match(h.last().url, /\/discussions\/d1\/notes$/);
      assert.equal(h.last().method, "POST");
    });
  }

  {
    h.setReply(() => resp({ body: "edited" }));
    const b = await P.editNote({ id: 3, kind: "line" }, "edited");
    t("gitlab: editNote PUTs and returns the new body", () => {
      assert.equal(b, "edited");
      assert.match(h.last().url, /\/notes\/3$/);
      assert.equal(h.last().method, "PUT");
    });
  }

  {
    h.setReply(() => resp(null, { status: 204 }));
    await P.deleteNote({ id: 3, kind: "line" });
    t("gitlab: deleteNote DELETEs the note", () => {
      assert.match(h.last().url, /\/notes\/3$/);
      assert.equal(h.last().method, "DELETE");
    });
  }

  {
    h.setReply(() => resp(null));
    await P.resolveThread({ id: "d1" }, true);
    t("gitlab: resolveThread PUTs resolved=true", () => {
      assert.match(h.last().url, /\/discussions\/d1\?resolved=true$/);
      assert.equal(h.last().method, "PUT");
    });
  }

  {
    const seen = [];
    h.setReply((url, o) => {
      seen.push({ url, method: o.method });
      return resp(null);
    });
    await P.review({ body: "lgtm", action: "approve" });
    t("gitlab: review approve posts a note then approves", () => {
      assert.ok(seen.some((c) => /\/notes$/.test(c.url) && c.method === "POST"));
      assert.ok(seen.some((c) => /\/approve$/.test(c.url) && c.method === "POST"));
    });
  }

  {
    h.setReply(() => resp({ data: { mergeRequestRequestChanges: { errors: [] } } }));
    await P.review({ body: "", action: "request" });
    t("gitlab: review request-changes uses graphql", () => {
      assert.match(h.last().url, /\/api\/graphql$/);
      assert.match(h.last().body, /mergeRequestRequestChanges/);
    });
  }

  {
    h.setReply(() => resp({ approved_by: [{ user: { id: 42 } }] }));
    const a = await P.approvedByMe(42);
    t("gitlab: approvedByMe reads the approvals list", () => assert.equal(a, true));
  }

  {
    h.setReply(() =>
      resp([
        {
          id: "sha1",
          short_id: "sha1sho",
          title: "c",
          author_name: "Ada",
          committed_date: "2026-07-01T00:00:00Z",
          web_url: "https://gl/c/sha1",
        },
      ])
    );
    const cs = await P.commits();
    t("gitlab: commits maps sha, title, author, date and url", () => {
      same(cs[0], {
        sha: "sha1",
        short: "sha1sho",
        title: "c",
        author: "Ada",
        date: "2026-07-01T00:00:00Z",
        webUrl: "https://gl/c/sha1",
      });
    });
  }

  {
    h.setReply(() => resp("DIFF", { text: "DIFF" }));
    const d = await P.commitDiff("abc");
    t("gitlab: commitDiff fetches the raw commit .diff", () => {
      assert.equal(d, "DIFF");
      assert.match(h.last().url, /\/group\/proj\/-\/commit\/abc\.diff$/);
    });
  }

  {
    h.setReply(() => resp("l1\nl2", { text: "l1\nl2" }));
    const lines = await P.fetchFile("dir/f.go");
    t("gitlab: fetchFile returns split lines from the raw endpoint", () => {
      same(lines, ["l1", "l2"]);
      assert.match(h.last().url, /\/repository\/files\/dir%2Ff\.go\/raw\?ref=head$/);
    });
  }

  {
    h.setReply(() => resp({ html: "<p>x</p>" }));
    const html = await P.markdown("x");
    t("gitlab: markdown posts to /markdown and returns html", () => {
      assert.equal(html, "<p>x</p>");
      assert.match(h.last().url, /\/markdown$/);
    });
  }

  {
    h.setReply(() => resp("W", { text: "W" }));
    const w = await P.whitespaceDiff();
    t("gitlab: whitespaceDiff fetches the ?w=1 variant", () => {
      assert.equal(w, "W");
      assert.match(h.last().url, /\?w=1$/);
    });
  }

  t("gitlab: permalink and blobUrl use the right sha", () => {
    assert.match(P.permalink("f.go", "new", 3), /\/blob\/head\/f\.go#L3$/);
    assert.match(P.permalink("f.go", "old", 3), /\/blob\/base\/f\.go#L3$/);
    assert.match(P.blobUrl("f.go"), /\/blob\/head\/f\.go$/);
  });

  {
    h.setReply(() => resp(null));
    await P.applySuggestion({ id: 55 });
    t("gitlab: applySuggestion PUTs the apply endpoint", () => {
      assert.match(h.last().url, /\/suggestions\/55\/apply$/);
      assert.equal(h.last().method, "PUT");
    });
  }

  {
    h.setReply(() =>
      resp([
        {
          id: 9,
          note: "draft",
          position: { position_type: "text", new_path: "f.go", new_line: 4 },
        },
      ])
    );
    const ds = await P.drafts();
    t("gitlab: drafts normalizes draft_notes", () => {
      assert.equal(ds[0].body, "draft");
      assert.equal(ds[0].pos.newLine, 4);
    });
  }

  {
    h.setReply(() => resp({ id: 10, note: "dn" }));
    const d = await P.postDraft({ path: "f.go", side: "new", endNew: 4, endOld: 3 }, "dn");
    t("gitlab: postDraft creates a draft with a position", () => {
      assert.equal(d.body, "dn");
      assert.match(JSON.parse(h.last().body).position.position_type, /text/);
    });
  }

  {
    h.setReply(() => resp({ id: 11, note: "reply-draft" }));
    await P.postDraft({ path: "f.go", side: "new" }, "reply-draft", "disc-99");
    t("gitlab: postDraft in reply carries in_reply_to_discussion_id", () => {
      assert.equal(JSON.parse(h.last().body).in_reply_to_discussion_id, "disc-99");
    });
  }

  {
    h.setReply(() => resp(null, { status: 204 }));
    await P.deleteDraft({ id: 9 });
    t("gitlab: deleteDraft DELETEs the draft", () => {
      assert.match(h.last().url, /\/draft_notes\/9$/);
      assert.equal(h.last().method, "DELETE");
    });
  }

  {
    h.setReply(() => resp(null));
    await P.publishDrafts();
    t("gitlab: publishDrafts PUTs bulk_publish", () => {
      assert.match(h.last().url, /\/draft_notes\/bulk_publish$/);
    });
  }

  {
    h.setReply(() => resp({ notes: [{ id: 12, author: { name: "Me", id: 1 }, created_at: "t", body: "m" }] }));
    await P.postThread(
      {
        path: "f.go",
        side: "new",
        endNew: 9,
        endOld: 8,
        multiline: true,
        start: { codeOld: "1", codeNew: "2", old: 7, new: 8 },
        end: { codeOld: "3", codeNew: "4", old: 8, new: 9 },
      },
      "m"
    );
    t("gitlab: multiline postThread builds a sha1-based line_range", () => {
      const pos = JSON.parse(h.last().body).position;
      assert.ok(pos.line_range, "line_range present");
      assert.match(pos.line_range.start.line_code, /^[0-9a-f]{40}_1_2$/);
      assert.equal(pos.line_range.end.type, "new");
    });
  }
})();

// ---- GitHub ----------------------------------------------------------------

const GH_LOC = { host: "github.com", pathname: "/owner/repo/pull/7.diff" };

await (async () => {
  const h = await harness({ location: GH_LOC, tokenHost: "github.com" });
  const { P } = h;
  P.setRefs(REFS);

  t("github: init loads the token and caps say no drafts", () => {
    assert.equal(P.token, "SEKRET");
    assert.equal(P.can.drafts, false);
    assert.equal(P.drafts, undefined);
  });

  {
    h.setReply(() => resp({ id: 42, login: "gh-me" }));
    const me = await P.me();
    t("github: me sends Bearer auth and normalizes login→name", () => {
      assert.equal(me.name, "gh-me");
      assert.match(h.last().url, /api\.github\.com\/user$/);
      assert.equal(h.last().headers.Authorization, "Bearer SEKRET");
    });
  }

  {
    h.setReply((url) => {
      if (/\/status$/.test(url)) return resp({ state: "success", total_count: 1 });
      if (/check-runs$/.test(url)) return resp({ check_runs: [] });
      return resp({
        title: "PR",
        head: { sha: "H", ref: "feat", repo: { full_name: "owner/repo" } },
        base: { sha: "B" },
        mergeable: false,
      });
    });
    const info = await P.info();
    t("github: info maps head/base sha, ci and conflicts", () => {
      assert.equal(info.title, "#7 PR");
      assert.equal(info.headSha, "H");
      assert.equal(info.ci.state, "success");
      assert.equal(info.conflicts, true);
    });
  }

  // A PR built by Actions alone reports total_count 0 on the status endpoint, so
  // the state has to come from check-runs — otherwise most repositories today
  // look like they have no CI at all.
  const ciStateFor = async (runs, statusReply = { state: "pending", total_count: 0 }) => {
    h.setReply((url) => {
      if (/\/status$/.test(url)) return resp(statusReply);
      if (/check-runs$/.test(url)) return resp({ check_runs: runs });
      return resp({
        title: "PR",
        head: { sha: "H", ref: "feat", repo: { full_name: "owner/repo" } },
        base: { sha: "B" },
      });
    });
    return (await P.info()).ci;
  };

  {
    const ok = await ciStateFor([
      { name: "build", status: "completed", conclusion: "success" },
      { name: "lint", status: "completed", conclusion: "skipped" },
    ]);
    t("github: ci state comes from check-runs when no commit statuses exist", () => {
      assert.equal(ok.state, "success");
      assert.equal(ok.ref, "H");
    });

    const bad = await ciStateFor([
      { name: "build", status: "completed", conclusion: "success" },
      { name: "e2e", status: "completed", conclusion: "failure" },
    ]);
    t("github: one failed check makes the whole pipeline failed", () =>
      assert.equal(bad.state, "failed"));

    const running = await ciStateFor([
      { name: "build", status: "completed", conclusion: "success" },
      { name: "e2e", status: "in_progress", conclusion: null },
    ]);
    t("github: an unfinished check keeps the pipeline pending", () =>
      assert.equal(running.state, "pending"));

    const none = await ciStateFor([]);
    t("github: no checks and no statuses means no ci at all", () => assert.equal(none, null));
  }

  {
    h.setReply((url) => {
      if (/check-runs$/.test(url))
        return resp({
          check_runs: [
            { name: "build", status: "completed", conclusion: "success", html_url: "u1" },
          ],
        });
      return resp({ statuses: [{ context: "legacy", state: "failure", target_url: "u2" }] });
    });
    const jobs = await P.ciJobs({ ref: "H", url: "p" });
    t("github: ciJobs lists check runs and legacy commit statuses together", () => {
      assert.deepEqual(jobs.map((j) => [j.name, j.state]), [
        ["build", "success"],
        ["legacy", "failed"],
      ]);
    });
  }

  {
    h.setReply((url) => {
      if (/\/graphql$/.test(url))
        return resp({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: "T1",
                      isResolved: false,
                      path: "f.go",
                      line: 9,
                      diffSide: "RIGHT",
                      comments: {
                        nodes: [
                          { databaseId: 100, body: "gh", createdAt: "t", author: { login: "u", databaseId: 5 } },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      return resp([]); // issue comments
    });
    const th = await P.threads();
    t("github: threads uses graphql (token) and normalizes side/resolved", () => {
      assert.equal(th[0].id, "T1");
      assert.equal(th[0].resolvable, true);
      assert.equal(th[0].pos.side, "new");
      assert.equal(th[0].pos.newLine, 9);
      assert.equal(th[0].replyToId, 100);
    });
  }

  {
    h.setReply(() => resp({ id: 101, user: { login: "u", id: 5 }, created_at: "t", body: "c" }));
    await P.postThread({ path: "f.go", side: "new", endNew: 9, endOld: 8 }, "c");
    t("github: postThread posts line/side to the review comments endpoint", () => {
      const body = JSON.parse(h.last().body);
      assert.equal(body.line, 9);
      assert.equal(body.side, "RIGHT");
      assert.equal(body.commit_id, "head");
      assert.match(h.last().url, /\/pulls\/7\/comments$/);
    });
  }

  {
    h.setReply(() => resp({ id: 102, user: { login: "u", id: 5 }, created_at: "t", body: "rep" }));
    await P.reply({ id: "T1", replyToId: 100, general: false }, "rep");
    t("github: reply posts to the comment replies endpoint", () => {
      assert.match(h.last().url, /\/pulls\/7\/comments\/100\/replies$/);
    });
  }

  {
    h.setReply(() => resp({ id: 103, user: { login: "u", id: 5 }, created_at: "t", body: "ic" }));
    await P.reply({ id: "__issue", general: true }, "ic");
    t("github: reply to a general thread posts an issue comment", () => {
      assert.match(h.last().url, /\/issues\/7\/comments$/);
    });
  }

  {
    h.setReply(() => resp({ body: "e2" }));
    const b = await P.editNote({ id: 5, kind: "line" }, "e2");
    t("github: editNote PATCHes a review comment", () => {
      assert.equal(b, "e2");
      assert.match(h.last().url, /\/pulls\/comments\/5$/);
      assert.equal(h.last().method, "PATCH");
    });
  }

  {
    h.setReply(() => resp(null, { status: 204 }));
    await P.deleteNote({ id: 6, kind: "issue" });
    t("github: deleteNote routes issue comments to the issues endpoint", () => {
      assert.match(h.last().url, /\/issues\/comments\/6$/);
      assert.equal(h.last().method, "DELETE");
    });
  }

  {
    h.setReply(() => resp({ data: { resolveReviewThread: { thread: { isResolved: true } } } }));
    await P.resolveThread({ id: "T1" }, true);
    t("github: resolveThread uses the resolve graphql mutation", () => {
      assert.match(h.last().body, /resolveReviewThread/);
    });
  }

  {
    const seen = [];
    h.setReply((url, o) => {
      seen.push({ url, method: o.method, body: o.body });
      return resp(null);
    });
    await P.review({ body: "changes pls", action: "request" });
    t("github: review request-changes posts a REQUEST_CHANGES review", () => {
      const c = seen.find((x) => /\/pulls\/7\/reviews$/.test(x.url));
      assert.ok(c);
      assert.equal(JSON.parse(c.body).event, "REQUEST_CHANGES");
    });
  }

  {
    const seen = [];
    h.setReply((url, o) => {
      seen.push({ url, method: o.method });
      if (/\/user$/.test(url)) return resp({ id: 42, login: "gh-me" });
      if (/\/reviews\?/.test(url)) return resp([{ id: 900, state: "APPROVED", user: { id: 42 } }]);
      return resp(null);
    });
    await P.review({ body: "", action: "unapprove" });
    t("github: review unapprove dismisses the last approval", () => {
      assert.ok(seen.some((c) => /\/reviews\/900\/dismissals$/.test(c.url) && c.method === "PUT"));
    });
  }

  {
    h.setReply((url) => {
      if (/\/user$/.test(url)) return resp({ id: 42, login: "gh-me" });
      return resp([{ id: 901, state: "APPROVED", user: { id: 42 } }]);
    });
    const a = await P.approvedByMe();
    t("github: approvedByMe reads my latest review state", () => assert.equal(a, true));
  }

  {
    h.setReply(() =>
      resp([
        {
          sha: "abcdef1234",
          html_url: "https://gh/c/abcdef1234",
          commit: { message: "msg\nbody", author: { name: "Ada", date: "2026-07-01T00:00:00Z" } },
        },
      ])
    );
    const cs = await P.commits();
    t("github: commits maps sha, title, author, date and url", () => {
      same(cs[0], {
        sha: "abcdef1234",
        short: "abcdef12",
        title: "msg",
        author: "Ada",
        date: "2026-07-01T00:00:00Z",
        webUrl: "https://gh/c/abcdef1234",
      });
    });
  }

  {
    const h2 = await harness({
      location: GH_LOC,
      tokenHost: "github.com",
      sendMessage: async (m) => {
        assert.match(m.url, /github\.com\/owner\/repo\/commit\/xyz\.diff$/);
        return { ok: true, text: "COMMITDIFF" };
      },
    });
    const d = await h2.P.commitDiff("xyz");
    t("github: commitDiff goes through the background fetchText message", () =>
      assert.equal(d, "COMMITDIFF"));
  }

  {
    h.setReply(() => resp("a\nb", { text: "a\nb" }));
    const lines = await P.fetchFile("f.go");
    t("github: fetchFile returns split lines via the raw contents accept", () => {
      same(lines, ["a", "b"]);
      assert.match(h.last().url, /\/contents\/f\.go\?ref=head$/);
    });
  }

  {
    h.setReply(() => resp("<p>md</p>", { text: "<p>md</p>" }));
    const html = await P.markdown("md");
    t("github: markdown returns rendered html", () => assert.equal(html, "<p>md</p>"));
  }

  t("github: permalink and blobUrl point at github blobs", () => {
    assert.match(P.permalink("f.go", "new", 3), /github\.com\/owner\/repo\/blob\/head\/f\.go#L3$/);
    assert.match(P.blobUrl("f.go"), /github\.com\/owner\/repo\/blob\/head\/f\.go$/);
  });

  {
    const calls = [];
    h.setReply((url, o) => {
      calls.push({ url, method: o.method, body: o.body });
      if (/\/pulls\/7$/.test(url))
        return resp({ head: { ref: "feat", repo: { full_name: "owner/repo" } } });
      if (/\/contents\/f\.go\?ref=feat$/.test(url))
        return resp({ content: globalThis.btoa("l0\nl1\nl2\nl3"), sha: "filesha" });
      return resp(null);
    });
    await P.applySuggestion({ path: "f.go", startLine: 2, endLine: 3, text: "NEW" });
    t("github: applySuggestion commits the spliced file to the head branch", () => {
      const put = calls.find((c) => c.method === "PUT");
      assert.ok(put, "PUT commit present");
      const body = JSON.parse(put.body);
      const content = globalThis.atob(body.content);
      assert.equal(content, "l0\nNEW\nl3");
      assert.equal(body.branch, "feat");
      assert.equal(body.sha, "filesha");
    });
  }
})();

console.log(`\n${passed} provider checks passed`);
