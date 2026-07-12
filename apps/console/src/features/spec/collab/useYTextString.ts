/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useCallback, useSyncExternalStore } from "react";
import type * as Y from "yjs";

/**
 * Subscribe to a live `Y.Text` and re-render on every content delta, returning
 * its current string (or `null` when no text is bound). `useCollabSpec`'s own
 * `version` counter only bumps when the set of doc paths changes, not on
 * per-keystroke content edits — so a consumer that needs the growing content of
 * one file (e.g. a streaming `design.cell` feeding the cell diagram) must
 * observe the `Y.Text` itself. Mirrors `observeRemote` in `textareaBinding.ts`,
 * but surfaces the value as React state instead of writing into a DOM node.
 *
 * String snapshots are primitives, so React compares them by value (Object.is)
 * — returning `ytext.toString()` from `getSnapshot` cannot loop.
 */
export function useYTextString(ytext: Y.Text | null): string | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!ytext) return () => {};
      ytext.observe(onStoreChange);
      return () => ytext.unobserve(onStoreChange);
    },
    [ytext],
  );

  const getSnapshot = useCallback(() => (ytext ? ytext.toString() : null), [ytext]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
