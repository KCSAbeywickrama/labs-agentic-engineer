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
 * What a turn of a scope that reports back with an outcome note (the Issues
 * chat, `./profiles.ts`) came to: the line the main chat's next turn is told
 * (a branch note, `conversations/thread-book.ts`).
 */

import type { ModelMessage } from "ai";

/** The registered write whose result is a filing (`../tools/registry.ts`). */
const CREATE_ISSUE = "create_issue";

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

/**
 * The issue this turn filed: the last `create_issue` call whose result names
 * the new issue's number, with the title the call filed (raw: the caller
 * sanitises it). Read defensively — the result is the MCP server's text
 * (`{"number":15,"url":…}`) and a refused, failed or unreadable call is no
 * filing. Undefined when the turn filed nothing.
 */
function filedIssue(messages: readonly ModelMessage[]): { number: number; title: string } | undefined {
  const titles = new Map<string, string>();
  let filed: { number: number; title: string } | undefined;
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const part of m.content) {
      if (part.type === "tool-call" && part.toolName === CREATE_ISSUE) {
        const title = (part.input as { title?: unknown } | null)?.title;
        if (typeof title === "string") titles.set(part.toolCallId, title);
      } else if (part.type === "tool-result" && part.toolName === CREATE_ISSUE) {
        const number = issueNumber(part.output);
        const title = titles.get(part.toolCallId);
        if (number !== undefined && title !== undefined) filed = { number, title };
      }
    }
  }
  return filed;
}

/** The `number` a create_issue result names, when it is a positive integer. */
function issueNumber(output: unknown): number | undefined {
  const o = output as { type?: unknown; value?: unknown } | null;
  let value: unknown;
  if (o?.type === "json") value = o.value;
  else if (o?.type === "text" && typeof o.value === "string") {
    try {
      value = JSON.parse(o.value);
    } catch {
      return undefined;
    }
  } else return undefined;
  const number = (value as { number?: unknown } | null)?.number;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : undefined;
}
