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

import { createSignal, For } from "solid-js";

interface Device {
  uuid: string;
  status: "allocated" | "pending" | "shared";
}

export function DeviceList(props: { devices: Device[] }) {
  const [filter, setFilter] = createSignal("");
  const shown = () =>
    props.devices.filter((d) => d.uuid.includes(filter()));
  return (
    <section class="devices">
      <input placeholder="filter…" onInput={(e) => setFilter(e.currentTarget.value)} />
      <ul>
        <For each={shown()}>{(d) => <li data-status={d.status}>{d.uuid}</li>}</For>
      </ul>
    </section>
  );
}
