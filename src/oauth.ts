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

import { githubDiffLocation } from "./source-archive";

export interface OAuthCredential {
  clientId: string;
  token: string;
  refreshToken?: string;
  expiresAt?: number;
  redirect?: string;
}

interface OAuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  interval?: number;
}

export const credentialKey = (host: string) => `oauthCredential:${host}`;
export const clientKey = (host: string) => `oauthClient:${host}`;

export function oauthOrigin(host: string): URL {
  const url = new URL(`https://${host}`);
  if (url.host !== host || url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("Invalid OAuth host");
  return url;
}

export function oauthHostForDiff(sender: string | undefined): string | null {
  if (!sender) return null;
  const url = new URL(sender);
  if (url.protocol !== "https:") return null;
  if (githubDiffLocation(url)) return "github.com";
  return /^\/.+\/-\/merge_requests\/\d+\.(?:diff|patch)$/.test(url.pathname) ? url.host : null;
}

export async function readOAuth(host: string): Promise<OAuthCredential | undefined> {
  const key = credentialKey(host);
  return (await chrome.storage.local.get(key))[key] as OAuthCredential | undefined;
}

function writeCredential<T>(host: string, change: () => Promise<T>) {
  return navigator.locks.request(credentialKey(host), change);
}

export function saveOAuth(host: string, credential: OAuthCredential) {
  return writeCredential(host, () => chrome.storage.local.set({ [credentialKey(host)]: credential }));
}

export function removeOAuth(host: string) {
  return writeCredential(host, () => chrome.storage.local.remove(credentialKey(host)));
}

export function tokenIsExpiring(credential: OAuthCredential) {
  return credential.expiresAt !== undefined && credential.expiresAt <= Date.now() + 30_000;
}

async function oauthPost(url: URL, params: Record<string, string>, signal?: AbortSignal): Promise<OAuthResponse> {
  const response = await fetch(url, {
    method: "POST",
    body: new URLSearchParams(params),
    headers: { Accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  const data = await response.json().catch(() => null) as OAuthResponse | null;
  if (!data || (!response.ok && !data.error)) throw new Error(`OAuth request failed (HTTP ${response.status})`);
  return data;
}

function tokenResponse(reply: OAuthResponse, clientId: string, redirect?: string): OAuthCredential {
  if (reply.error || typeof reply.access_token !== "string" || !reply.access_token)
    throw new Error(reply.error === "invalid_grant" ? "Authorization expired. Sign in again." :
      `OAuth authorization failed${reply.error ? ` (${reply.error})` : ""}`);
  return {
    clientId, token: reply.access_token, redirect,
    refreshToken: reply.refresh_token,
    expiresAt: typeof reply.expires_in === "number" && Number.isFinite(reply.expires_in) && reply.expires_in > 0
      ? Date.now() + reply.expires_in * 1000 : undefined,
  };
}

export async function githubDevice(clientId: string, signal: AbortSignal) {
  const data = await oauthPost(new URL("https://github.com/login/device/code"),
    { client_id: clientId, scope: "repo" }, signal);
  if (data.error) throw new Error(`Could not start GitHub sign-in (${data.error})`);
  if (!data.device_code || !data.user_code || data.verification_uri !== "https://github.com/login/device" ||
      typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0)
    throw new Error("GitHub returned an invalid device code");
  return { deviceCode: data.device_code, userCode: data.user_code, verification: data.verification_uri,
    expiresAt: Date.now() + data.expires_in * 1000, interval: Math.max(1, data.interval || 5) * 1000 };
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function githubToken(clientId: string, device: Awaited<ReturnType<typeof githubDevice>>, signal: AbortSignal) {
  let interval = device.interval;
  while (Date.now() + interval < device.expiresAt) {
    await wait(interval, signal);
    const reply = await oauthPost(new URL("https://github.com/login/oauth/access_token"), {
      client_id: clientId, device_code: device.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }, signal);
    if (reply.error === "authorization_pending") continue;
    if (reply.error === "slow_down") { interval = Math.max(interval + 5000, (reply.interval ?? 0) * 1000); continue; }
    return tokenResponse(reply, clientId);
  }
  throw new Error("GitHub device code expired. Start again.");
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function gitlabLogin(host: string, clientId: string, signal: AbortSignal) {
  const origin = oauthOrigin(host);
  const redirect = chrome.identity.getRedirectURL();
  const state = random();
  const verifier = random();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const login = new URL("/oauth/authorize", origin);
  login.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: "code", scope: "api",
    state, code_challenge: base64url(new Uint8Array(hash)), code_challenge_method: "S256",
  }).toString();
  signal.throwIfAborted();
  const completion = await chrome.identity.launchWebAuthFlow({ url: login.href, interactive: true });
  signal.throwIfAborted();
  if (!completion) throw new Error("GitLab did not complete sign-in");
  const callback = new URL(completion);
  const expected = new URL(redirect);
  const code = callback.searchParams.get("code");
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname ||
      callback.searchParams.get("state") !== state || !code) throw new Error("Invalid GitLab OAuth callback");
  const reply = await oauthPost(new URL("/oauth/token", origin), {
    client_id: clientId, redirect_uri: redirect, grant_type: "authorization_code", code, code_verifier: verifier,
  }, signal);
  return tokenResponse(reply, clientId, redirect);
}

const refreshes = new Map<string, Promise<OAuthCredential | undefined>>();

async function refreshOAuth(host: string) {
  let pending = refreshes.get(host);
  if (!pending) {
    pending = (async () => {
      const old = await readOAuth(host);
      if (!old || !tokenIsExpiring(old)) return old;
      if (!old.refreshToken) return undefined;
      const github = host === "github.com";
      if (!github && !old.redirect) return undefined;
      const endpoint = github ? "/login/oauth/access_token" : "/oauth/token";
      const params: Record<string, string> = {
        grant_type: "refresh_token", client_id: old.clientId, refresh_token: old.refreshToken,
      };
      if (!github && old.redirect) params.redirect_uri = old.redirect;
      const reply = await oauthPost(new URL(endpoint, oauthOrigin(host)), params);
      return writeCredential(host, async () => {
        // Disconnect or a fresh sign-in may have replaced this session during the request.
        const current = await readOAuth(host);
        if (current?.token !== old.token) return current;
        if (reply.error === "invalid_grant" || reply.error === "bad_refresh_token") {
          await chrome.storage.local.remove(credentialKey(host));
          return undefined;
        }
        const credential = tokenResponse(reply, old.clientId, old.redirect);
        await chrome.storage.local.set({ [credentialKey(host)]: credential });
        return credential;
      });
    })().finally(() => refreshes.delete(host));
    refreshes.set(host, pending);
  }
  return pending;
}


export async function refreshOAuthToken(host: string) {
  const credential = await refreshOAuth(host).catch(() => undefined);
  return credential && !tokenIsExpiring(credential) ? credential.token : null;
}
