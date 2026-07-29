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

// A couple of static, content-owned globals the Solid components read directly
// (icons) or content reads back (custom themes). Everything else is now passed
// or shared through the store, not window.
declare global {
  interface Window {
    ptIcons: Record<string, string>;
    ptCustomThemes: Record<string, string>;
  }
}

export {};
