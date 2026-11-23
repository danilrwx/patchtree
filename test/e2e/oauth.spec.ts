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

import { test, expect } from "./fixtures";
import { mockGithubStateful, DIFF_URL as GITHUB_DIFF, OWNER, REPO, NUM } from "../fixtures/github";
import { mockGitlab, DIFF_URL as GITLAB_DIFF, HOST, TOKEN_HOST } from "../fixtures/gitlab";

const clientId = "patchtree-test-client";

test("GitHub device OAuth enables authenticated review requests", async ({ context, page }) => {
  await mockGithubStateful(context);
  await page.goto(GITHUB_DIFF);
  await page.locator("#pt-settings > summary").click();
  const [login] = await Promise.all([
    context.waitForEvent("page"),
    page.getByText("Sign in with OAuth…", { exact: true }).click(),
  ]);
  await expect(login.getByRole("heading")).toHaveText("Sign in to GitHub");
  await login.evaluate(() => {
    let polls = 0;
    const request = fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = String(input);
      const params = new URLSearchParams(String(init?.body));
      if (url === "https://github.com/login/device/code") {
        if (!params.get("client_id") || params.get("scope") !== "repo") throw new Error("Wrong device request");
        return Promise.resolve(Response.json({
          device_code: "test-device", user_code: "ABCD-1234", expires_in: 300, interval: 1,
          verification_uri: "https://github.com/login/device",
        }));
      }
      if (url === "https://github.com/login/oauth/access_token") {
        if (params.get("device_code") !== "test-device" || params.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code")
          throw new Error("Wrong token exchange");
        if (++polls === 1) return Promise.resolve(Response.json({ error: "authorization_pending" }));
        return Promise.resolve(Response.json({
          access_token: "oauth-test-github", token_type: "bearer", expires_in: 7200, refresh_token: "github-refresh",
        }));
      }
      return request(input, init);
    };
  });
  await login.locator("#client").evaluate((input, id) => { (input as HTMLInputElement).value = id; }, clientId);
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(login.getByText("ABCD-1234")).toBeVisible();
  await expect(login.getByRole("link", { name: "Open GitHub to authorize" })).toHaveAttribute("href", "https://github.com/login/device");
  await expect(login.getByRole("status")).toContainText("Connected");
  const signedIn = page.getByText("Signed in to GitHub", { exact: true });
  await expect(signedIn).toBeAttached();
  const noWebSession = (route: import("@playwright/test").Route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: "<h1>Page not found</h1>" });
  await context.route(GITHUB_DIFF, noWebSession);
  const pullDiff = page.waitForRequest((request) =>
    request.url() === `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${NUM}` &&
    request.headers().accept === "application/vnd.github.diff" &&
    request.headers().authorization === "Bearer oauth-test-github");
  const api = page.waitForRequest((request) =>
    request.url() === "https://api.github.com/user" && request.headers().authorization === "Bearer oauth-test-github");
  await page.reload();
  await Promise.all([api, pullDiff]);
  const lineNumber = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ }).first();
  await lineNumber.click();
  const body = "e2e: review comment using OAuth";
  await page.locator(".pt-comment-form textarea").first().fill(body);
  const write = page.waitForRequest((request) =>
    request.method() === "POST" &&
    request.url() === `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${NUM}/comments` &&
    request.headers().authorization === "Bearer oauth-test-github");
  await page.locator(".pt-comment-form button.pt-primary").first().click();
  expect((await write).postDataJSON().body).toBe(body);
  await expect(page.locator(".pt-comments-row", { hasText: body }).first()).toBeAttached();

  const worker = context.serviceWorkers()[0];
  await worker.evaluate(async () => {
    const key = "oauthCredential:github.com";
    const old = (await chrome.storage.local.get(key))[key] as { expiresAt: number };
    await chrome.storage.local.set({ [key]: { ...old, expiresAt: 1 } });
    const request = fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      if (String(input) !== "https://github.com/login/oauth/access_token") return request(input, init);
      const params = new URLSearchParams(String(init?.body));
      if (params.get("grant_type") !== "refresh_token" || params.get("refresh_token") !== "github-refresh" ||
          !params.get("client_id") || params.has("client_secret")) throw new Error("Wrong GitHub refresh exchange");
      return Promise.resolve(Response.json({
        access_token: "oauth-github-renewed", refresh_token: "github-refresh-rotated", expires_in: 7200,
      }));
    };
  });
  const renewed = page.waitForRequest((request) => request.url() === "https://api.github.com/user" &&
    request.headers().authorization === "Bearer oauth-github-renewed");
  await page.reload();
  await renewed;

  await login.getByRole("button", { name: "Disconnect" }).click();
  await expect(login.getByRole("status")).toContainText("Disconnected");
  await expect(page.getByText("Sign in with OAuth…", { exact: true })).toBeAttached();
  await context.unroute(GITHUB_DIFF, noWebSession);
  const anonymous = page.waitForRequest((request) => request.url() === "https://api.github.com/user" &&
    !request.headers().authorization);
  await page.reload();
  await anonymous;
});

test("GitLab public OAuth uses PKCE and refreshes the token for the same host", async ({ context, page }) => {
  await mockGitlab(context);
  await page.goto(GITLAB_DIFF);
  await page.locator("#pt-settings > summary").click();
  const [login] = await Promise.all([
    context.waitForEvent("page"),
    page.getByText("Sign in with OAuth…", { exact: true }).click(),
  ]);
  await expect(login.getByRole("heading")).toHaveText(`Sign in to ${TOKEN_HOST}`);
  await login.evaluate(({ host }) => {
    chrome.permissions.request = async ({ origins }) => origins?.[0] === `${host}/*`;
    let challenge = "";
    chrome.identity.launchWebAuthFlow = (async ({ url }) => {
      const target = new URL(url);
      if (target.origin !== host || target.pathname !== "/oauth/authorize" ||
          target.searchParams.get("code_challenge_method") !== "S256" || target.searchParams.get("scope") !== "api")
        throw new Error("Wrong GitLab consent URL");
      challenge = target.searchParams.get("code_challenge")!;
      const redirect = new URL(target.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", "test-gitlab-code");
      redirect.searchParams.set("state", target.searchParams.get("state")!);
      return redirect.href;
    }) as typeof chrome.identity.launchWebAuthFlow;
    const request = fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      if (String(input) !== `${host}/oauth/token`) return request(input, init);
      const params = new URLSearchParams(String(init?.body));
      const verifier = params.get("code_verifier")!;
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const computed = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      if (computed !== challenge || params.get("code") !== "test-gitlab-code") throw new Error("Wrong PKCE exchange");
      return Response.json({ access_token: "gitlab-oauth-initial", refresh_token: "gitlab-refresh", expires_in: 7200 });
    };
  }, { host: HOST });
  await login.getByLabel("OAuth application client ID").fill(clientId);
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(login.getByRole("status")).toContainText("Connected");

  const worker = context.serviceWorkers()[0];
  await worker.evaluate(async ({ host, origin }) => {
    const key = `oauthCredential:${host}`;
    const old = (await chrome.storage.local.get(key))[key] as { expiresAt: number };
    await chrome.storage.local.set({ [key]: { ...old, expiresAt: 1 } });
    const request = fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      if (String(input) !== `${origin}/oauth/token`) return request(input, init);
      const params = new URLSearchParams(String(init?.body));
      if (params.get("grant_type") !== "refresh_token" || params.get("refresh_token") !== "gitlab-refresh")
        throw new Error("Wrong refresh exchange");
      return Promise.resolve(Response.json({
        access_token: "gitlab-oauth-renewed", refresh_token: "gitlab-refresh-rotated", expires_in: 7200,
      }));
    };
  }, { host: TOKEN_HOST, origin: HOST });

  const api = page.waitForRequest((request) => request.url() === `${HOST}/api/v4/user` &&
    request.headers().authorization === "Bearer gitlab-oauth-renewed");
  await page.reload();
  await api;
});
