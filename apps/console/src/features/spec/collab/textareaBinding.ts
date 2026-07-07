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

import type * as Y from "yjs";

// Minimal textarea ↔ Y.Text binding for the placeholder editor (#86 phase 5).
// Local input becomes a prefix/suffix-trimmed delete+insert (so concurrent
// remote edits merge at the CRDT level instead of being clobbered); remote
// updates re-render the value with the local caret restored. The real
// per-type editors (Tiptap, #86 phase 6) replace this wholesale.

/** Apply `next` to `ytext` as a minimal edit relative to its current value. */
export function applyTextareaValue(ytext: Y.Text, next: string): void {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  while (
    start < prev.length &&
    start < next.length &&
    prev[start] === next[start]
  ) {
    start++;
  }
  let prevEnd = prev.length;
  let nextEnd = next.length;
  while (
    prevEnd > start &&
    nextEnd > start &&
    prev[prevEnd - 1] === next[nextEnd - 1]
  ) {
    prevEnd--;
    nextEnd--;
  }
  ytext.doc?.transact(() => {
    if (prevEnd > start) ytext.delete(start, prevEnd - start);
    if (nextEnd > start) ytext.insert(start, next.slice(start, nextEnd));
  });
}

/**
 * Keep a textarea in sync with remote Y.Text changes. Returns an unobserve
 * cleanup. Local edits must go through `applyTextareaValue` (the observer
 * skips transactions originating from this doc's local client).
 */
export function observeRemote(
  ytext: Y.Text,
  textarea: HTMLTextAreaElement,
  isLocal: (transaction: Y.Transaction) => boolean,
): () => void {
  const handler = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (isLocal(transaction)) return;
    const { selectionStart, selectionEnd } = textarea;
    textarea.value = ytext.toString();
    textarea.setSelectionRange(selectionStart, selectionEnd);
  };
  ytext.observe(handler);
  return () => ytext.unobserve(handler);
}
