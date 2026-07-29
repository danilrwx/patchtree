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

// The content and review scripts are separate bundles that talk over window
// globals (a bundle boundary the merge phase will remove). Type them so the
// .ts sources compile; the loosely-typed bridges become direct imports later.
import type { Provider } from "./types";
import type { ReviewThread, Composing } from "./store";

declare global {
  interface Window {
    ptProvider: Provider | null;
    ptStore: {
      setReviewThreads: (t: ReviewThread[]) => void;
      setComposing: (c: Composing | null) => void;
      composing: () => Composing | null;
    };
    // built by content.js, consumed by review.js — shape is internal
    ptView: any;
    // review action bridge for the Solid thread components
    ptReview: any;
    ptIcons: Record<string, string>;
    ptCustomThemes: Record<string, string>;
    ptUpdateProgress?: () => void;
  }
}
