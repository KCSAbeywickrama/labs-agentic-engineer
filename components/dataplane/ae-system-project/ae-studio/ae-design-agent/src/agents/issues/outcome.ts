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

/**
 * What an Issues turn came to: the line the main chat's next turn is told
 * (a branch note, `conversations/thread-book.ts`).
 */

import type { ModelMessage } from "ai";
import { filedIssue } from "./filing-gate.js";

/** The longest a turn's outcome (and so a branch note's) may be. */
export const OUTCOME_MAX_CHARS = 400;

/**
 * What an Issues turn came to, from the messages it appended:
 * `Filed #<number>: <title>` when it filed an issue (`filedIssue`), which is
 * built from the filing itself rather than from prose; otherwise the last
 * non-blank text part of its replies. Both are model or user text, so the
 * title and the reply are sanitised (`oneLine`) BEFORE the cap: a line break
 * would start a line of its own in the main agent's prompt. Cut to
 * `OUTCOME_MAX_CHARS` UTF-16 units ending in `…`, never splitting a surrogate
 * pair. A turn that neither filed nor replied in text has none.
 */
export function turnOutcome(messages: readonly ModelMessage[]): string | undefined {
  const filed = filedIssue(messages);
  const title = filed ? oneLine(filed.title) : "";
  const outcome =
    filed && title !== ""
      ? `Filed #${filed.number}: ${title}`
      : messages
          .flatMap((m) => {
            if (m.role !== "assistant") return [];
            return typeof m.content === "string"
              ? [m.content]
              : m.content.flatMap((p) => (p.type === "text" ? [p.text] : []));
          })
          .map(oneLine)
          .filter((t) => t !== "")
          .pop();
  if (outcome === undefined || outcome.length <= OUTCOME_MAX_CHARS) return outcome;
  let cut = outcome.slice(0, OUTCOME_MAX_CHARS - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Text made one line: control characters other than whitespace removed, every
 * run of whitespace (line breaks, U+2028/U+2029, NEL and tabs included)
 * collapsed to one space, trimmed.
 */
function oneLine(text: string): string {
  return text
    .replace(/\p{Cc}/gu, (c) => (/[\s\u0085]/.test(c) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}
