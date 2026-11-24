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

import type { Provider } from "../types";
import { gitlab } from "./gitlab";
import { github } from "./github";
import { githubDiffLocation } from "../source-archive";

// Review providers: one normalized interface, two implementations. Returns the
// provider matching the current page, or null (e.g. a local file:// patch).
export function makeProvider(): Provider | null {
  const path = location.pathname;
  const m = /^\/(.+)\/-\/merge_requests\/(\d+)\.(?:diff|patch)$/.exec(path);
  if (m) return gitlab(m[1], m[2]);
  const route = githubDiffLocation(location);
  return route ? github(route.owner, route.repo, route.ref, route.commit) : null;
}
