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

// WHAT IDENTIFIES A COMMAND IS AT ITS END.
//
// `text-overflow: ellipsis` eats the end, and a column of shell commands is
// where that costs the most: five `cd expense-webapp && npm install …` rows all
// rendered as the same sentence, five different installs a reader could not tell
// apart. The same shape as an absolute path, whose last segment is the file.
//
// So the row keeps its tail and gives up its middle. The split is done here, in
// characters; the ELISION itself is CSS, because only the browser knows how wide
// the column ended up — the head is an overflowing box that ellipsises, the tail
// never shrinks. Nothing is dropped from the DOM, so the whole string is still
// the row's text for a screen reader and still there to be copied.

/**
 * How much of the end to protect, in characters.
 *
 * Long enough for the part that distinguishes one command from its neighbours —
 * a package and its version, a path's last segments — and short enough to leave
 * the head room to say what KIND of command it is on a narrow column.
 */
const TAIL_CHARS = 24;

/** The shortest tail worth ending on a word boundary for. */
const MIN_WORD_TAIL = 6;

export interface ElidedText {
  /** The part that may be ellipsised, "" when the whole string is the tail. */
  head: string;
  /** The part that must survive. */
  tail: string;
}

/**
 * Split a string into a head that may be elided and a tail that may not.
 *
 * The cut moves FORWARD to the next word boundary at or after the budget, so the
 * tail starts on a whole word (`install react@19.2.3`, not `all react@19.2.3`)
 * and is never longer than the budget — the head keeps the room it was promised.
 * A boundary so late that the tail would identify nothing is ignored, and the
 * budget wins.
 *
 * A string short enough to fit its own budget is ALL tail: there is nothing to
 * protect it from, and a head of "" renders no ellipsis.
 */
export function elideMiddle(text: string, tailChars = TAIL_CHARS): ElidedText {
  if (text.length <= tailChars) return { head: "", tail: text };

  const budget = text.length - tailChars;
  const space = text.indexOf(" ", budget);
  const at =
    space !== -1 && text.length - (space + 1) >= MIN_WORD_TAIL ? space + 1 : budget;
  return { head: text.slice(0, at), tail: text.slice(at) };
}
