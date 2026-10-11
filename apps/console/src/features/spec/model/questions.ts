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

import { parseLine, type LineBlock } from "./ids";

// The questions a feature's interview waits on, read from the feature's own
// file. A blocking question is an entry of its `## Open Questions` ending with
// the literal tag `*blocking*` (as `*assumed*` closes a line), and the answers
// the agent offers are the entry's nested bullets, each worded as the decision
// it becomes:
//
//   ## Open Questions
//   1. Does finance post to one Xero organisation, or one per country? *blocking*
//      - Finance posts every claim to one Xero organisation.
//      - Each country has its own Xero organisation; …
//
// Answering it takes the entry out and the answer into Decisions
// (collab/specEdits.ts), so no blocking state lives outside the file. A tag
// with no options is still a question, answered in the user's own words;
// options under an entry with no tag are an ordinary open question, which
// gates nothing. Every entry but one the user deferred ("deferred — the user
// will decide later", prd-contract) is open: it waits on the user, and the
// Design card asks the ones in designed features (the gap check's).

export const OPEN_QUESTIONS = "Open Questions";

/** A question the interview cannot go on without. */
export interface BlockingQuestion {
  /** The entry's words, without the tag. */
  question: string;
  /** The answers the agent offers, each worded as the decision it becomes. */
  options: string[];
}

/** An entry of Open Questions the user has not deferred. */
export interface OpenQuestion extends BlockingQuestion {
  /** Tagged `*blocking*`: its feature's interview waits on it. */
  blocking: boolean;
}

/** An open question with the line it is written on: what the editor decorates and an answer removes. */
export interface OpenEntry<L extends LineBlock> extends OpenQuestion {
  line: L;
}

/** A blocking question with the line it is written on. */
export type BlockingEntry<L extends LineBlock> = OpenEntry<L>;

/** An entry the user declined for now: "deferred — the user will decide later". */
const DEFERRED = /\bdeferred\b/i;

function isSectionHeading(line: LineBlock): boolean {
  return line.kind === "heading" && (line.level ?? 1) <= 2;
}

/** Every open question in a file's lines, in order, with its line. */
export function openEntries<L extends LineBlock>(lines: readonly L[]): OpenEntry<L>[] {
  const out: OpenEntry<L>[] = [];
  let inside = false;
  let open: { entry: OpenEntry<L>; depth: number } | null = null;
  for (const line of lines) {
    if (isSectionHeading(line)) {
      inside = line.text.trim().toLowerCase() === OPEN_QUESTIONS.toLowerCase();
      open = null;
      continue;
    }
    if (!inside || line.kind !== "listItem") continue;
    const depth = line.depth ?? 1;
    if (open && depth === open.depth + 1) {
      if (line.text.trim()) open.entry.options.push(line.text.trim());
      continue;
    }
    if (open && depth > open.depth) continue;
    open = null;
    const parts = parseLine(line.text, line.emphasis);
    const entry: OpenEntry<L> = { question: parts.body, options: [], blocking: parts.blocking !== null, line };
    // A deferred entry's options are still read past, but the entry is not open.
    if (!DEFERRED.test(line.text)) out.push(entry);
    open = { entry, depth };
  }
  return out;
}

/** Every blocking question in a file's lines, in order, with its line. */
export function blockingEntries<L extends LineBlock>(lines: readonly L[]): BlockingEntry<L>[] {
  return openEntries(lines).filter((e) => e.blocking);
}

/** A file's open questions, without their lines. */
export function openQuestions(lines: readonly LineBlock[]): OpenQuestion[] {
  return openEntries(lines).map(({ question, options, blocking }) => ({ question, options, blocking }));
}

/** A file's blocking questions, without their lines. */
export function blockingQuestions(lines: readonly LineBlock[]): BlockingQuestion[] {
  return blockingEntries(lines).map(({ question, options }) => ({ question, options }));
}
