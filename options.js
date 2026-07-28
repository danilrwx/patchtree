// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
"use strict";

const list = document.getElementById("list");
const ghToken = document.getElementById("gh-token");

async function save() {
  const gitlabs = {};
  for (const tr of list.querySelectorAll("tr[data-row]")) {
    const [host, tok] = tr.querySelectorAll("input");
    const h = host.value.trim();
    if (h && h !== "github.com") gitlabs[h] = { token: tok.value.trim() };
  }
  if (ghToken.value.trim()) gitlabs["github.com"] = { token: ghToken.value.trim() };
  await chrome.storage.sync.set({ gitlabs });
}

function addRow(host = "", tok = "") {
  const tr = document.createElement("tr");
  tr.dataset.row = "1";
  tr.innerHTML =
    `<td><input placeholder="gitlab.example.com" value=""></td>` +
    `<td><input type="password" placeholder="glpat-…" value=""></td>` +
    `<td><button>✕</button></td>`;
  const [h, t] = tr.querySelectorAll("input");
  h.value = host;
  t.value = tok;
  tr.querySelector("button").addEventListener("click", () => {
    tr.remove();
    save();
  });
  tr.addEventListener("change", save);
  list.appendChild(tr);
}

document.getElementById("add").addEventListener("click", () => addRow());
ghToken.addEventListener("change", save);

chrome.storage.sync.get("gitlabs").then(({ gitlabs = {} }) => {
  ghToken.value = gitlabs["github.com"]?.token || "";
  const rest = Object.entries(gitlabs).filter(([host]) => host !== "github.com");
  for (const [host, v] of rest) addRow(host, v.token || "");
  if (rest.length === 0) addRow();
});
