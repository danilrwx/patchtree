"use strict";

const list = document.getElementById("list");

async function save() {
  const gitlabs = {};
  for (const tr of list.querySelectorAll("tr[data-row]")) {
    const [host, tok] = tr.querySelectorAll("input");
    if (host.value.trim()) gitlabs[host.value.trim()] = { token: tok.value.trim() };
  }
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

chrome.storage.sync.get("gitlabs").then(({ gitlabs = {} }) => {
  for (const [host, v] of Object.entries(gitlabs)) addRow(host, v.token || "");
  if (Object.keys(gitlabs).length === 0) addRow();
});
