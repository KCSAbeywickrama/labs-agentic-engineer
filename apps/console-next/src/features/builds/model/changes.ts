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

import { lineWords } from "../../spec/model/designWork";
import { parseLine, type LineBlock } from "../../spec/model/ids";
import type { BuiltLine } from "../api/builds";

// What changed in a feature's spec since it was last built. A build keeps
// each feature's lines as it built them; the picker compares them with the
// live spec. A line with its own ID (a story, "F2.4") is followed by its ID,
// so rewording it is an edit; a line without one (a decision) is known only
// by its words, so rewording it retires the old line and adds a new one.
// Headings and a pending proposal's lines are not the spec, and dropping an
// `*assumed*` tag changes no words: none of them is a change.

/** A feature file's lines as a build reads them. */
export function builtLines(lines: LineBlock[]): BuiltLine[] {
  return lines
    .filter((l) => !l.proposed && l.kind !== "heading")
    .map((l) => ({ id: parseLine(l.text, l.emphasis).lead?.id ?? null, words: lineWords(l) }))
    .filter((l) => l.words.length > 0);
}

export interface LineChanges {
  added: number;
  edited: number;
  retired: number;
}

/** How many of each word appear in `a` beyond those in `b`. */
function unmatched(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const w of b) left.set(w, (left.get(w) ?? 0) + 1);
  let n = 0;
  for (const w of a) {
    const k = left.get(w) ?? 0;
    if (k > 0) left.set(w, k - 1);
    else n += 1;
  }
  return n;
}

export function lineChanges(built: BuiltLine[], now: BuiltLine[]): LineChanges {
  const byId = (lines: BuiltLine[]) => new Map(lines.flatMap((l) => (l.id ? [[l.id, l.words] as const] : [])));
  const free = (lines: BuiltLine[]) => lines.filter((l) => !l.id).map((l) => l.words);
  const then = byId(built);
  const current = byId(now);
  let added = unmatched(free(now), free(built));
  let retired = unmatched(free(built), free(now));
  let edited = 0;
  for (const [id, words] of current) {
    const was = then.get(id);
    if (was === undefined) added += 1;
    else if (was !== words) edited += 1;
  }
  for (const id of then.keys()) if (!current.has(id)) retired += 1;
  return { added, edited, retired };
}

/** "1 added, 2 edited"; empty when nothing changed. */
export function changeWords(changes: LineChanges): string {
  return [
    changes.added && `${changes.added} added`,
    changes.edited && `${changes.edited} edited`,
    changes.retired && `${changes.retired} retired`,
  ]
    .filter(Boolean)
    .join(", ");
}
