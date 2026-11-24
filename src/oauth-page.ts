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

import {
  clientKey, githubDevice, githubToken, gitlabLogin, oauthOrigin, readOAuth, removeOAuth, saveOAuth, type OAuthCredential,
} from "./oauth";

declare const PATCHTREE_GITHUB_CLIENT_ID: string;
declare const PATCHTREE_GITLAB_CLIENT_ID: string;

const host = new URLSearchParams(location.search).get("host") ?? "";
const github = host === "github.com";
const connect = document.querySelector<HTMLButtonElement>("#connect")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const disconnect = document.querySelector<HTMLButtonElement>("#disconnect")!;
const status = document.querySelector<HTMLElement>("#status")!;
const client = document.querySelector<HTMLInputElement>("#client")!;
const device = document.querySelector<HTMLElement>("#device")!;
const verification = document.querySelector<HTMLAnchorElement>("#verify")!;
let pending: AbortController | undefined;

async function setup() {
  const origin = oauthOrigin(host);
  const provider = github ? "GitHub" : host;
  document.querySelector("#heading")!.textContent = `Sign in to ${provider}`;
  document.querySelector("#purpose")!.textContent = github
    ? "Authorize Patchtree to read repositories and post reviews using the repo scope."
    : "Authorize Patchtree to read repositories and post reviews using the api scope.";
  const key = clientKey(host);
  const bundled = github ? PATCHTREE_GITHUB_CLIENT_ID : host === "gitlab.com" ? PATCHTREE_GITLAB_CLIENT_ID : "";
  const saved = await chrome.storage.local.get(key);
  client.value = typeof saved[key] === "string" ? saved[key] : bundled;
  const registered = bundled && !saved[key];
  if (!registered) {
    document.querySelector<HTMLElement>("#setup")!.hidden = false;
    document.querySelector("#configuration")!.textContent = github
      ? "Use a GitHub OAuth App with Device Flow enabled."
      : "Register a public GitLab application with the api scope and the redirect URL below.";
    if (github) {
      document.querySelector<HTMLElement>("#github-setup")!.hidden = false;
    } else {
      document.querySelector("#redirect")!.textContent = chrome.identity.getRedirectURL();
      document.querySelector<HTMLElement>("#callback")!.hidden = false;
    }
  }
  const setConnected = (connected: boolean) => {
    disconnect.hidden = !connected;
    connect.hidden = connected;
    connect.disabled = false;
  };
  if (await readOAuth(host)) {
    setConnected(true);
    status.textContent = "Connected. Reload the diff to use this account.";
  } else setConnected(false);

  connect.addEventListener("click", async () => {
    const clientId = client.value.trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) {
      status.textContent = "Enter the client ID of your OAuth application.";
      return;
    }
    connect.disabled = true;
    cancel.hidden = false;
    const job = new AbortController();
    pending = job;
    const signal = job.signal;
    status.textContent = "Starting sign-in…";
    try {
      if (!github) {
        // Browser host patterns cover all ports for a hostname. Requests still use the exact origin.
        const granted = await chrome.permissions.request({ origins: [`https://${origin.hostname}/*`] });
        if (!granted) throw new Error("Access to this GitLab instance was not granted");
      }
      let credential: OAuthCredential;
      if (github) {
        const prompt = await githubDevice(clientId, signal);
        verification.href = prompt.verification;
        document.querySelector("#device-code")!.textContent = prompt.userCode;
        device.hidden = false;
        status.textContent = "Waiting for authorization…";
        credential = await githubToken(clientId, prompt, signal);
      } else {
        credential = await gitlabLogin(host, clientId, signal);
      }
      signal.throwIfAborted();
      await saveOAuth(host, credential);
      if (!registered) await chrome.storage.local.set({ [key]: clientId });
      setConnected(true);
      status.textContent = "Connected. Reload the diff to use this account.";
    } catch (error) {
      status.textContent = signal.aborted ? "Sign-in cancelled." :
        error instanceof Error ? error.message : "Sign-in failed.";
    } finally {
      pending = undefined;
      device.hidden = true;
      cancel.hidden = true;
      connect.disabled = false;
    }
  });
  cancel.addEventListener("click", () => pending?.abort());
  disconnect.addEventListener("click", async () => {
    try {
      await removeOAuth(host);
      setConnected(false);
      status.textContent = "Disconnected in Patchtree. Reload the diff to apply this change.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not disconnect.";
    }
  });
}

void setup().catch((error) => {
  status.textContent = error instanceof Error ? error.message : "Sign-in unavailable.";
});
