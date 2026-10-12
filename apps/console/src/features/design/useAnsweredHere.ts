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

import { useSyncExternalStore } from "react";

// Which features' questions the user answered on the Design card, in this
// browser, each with the basis its design had then. The answer is an edit of
// the feature's file, so the feature reads as out of date just as a Spec edit
// would; knowing the answer came from here lets the Overview say so ("Your
// answer changed Place an order") instead of "You changed it in Spec". Kept
// until the page goes: after a reload the cause is not known, and the note
// says what it always did.

/** Feature ID → the basis its design had (`designedFrom`) when its question was answered here. */
export type AnsweredHere = ReadonlyMap<string, string | undefined>;

const NONE: AnsweredHere = new Map();
const answered = new Map<string, AnsweredHere>();
const listeners = new Set<() => void>();

/** Note that a question of `featureId`'s was answered on the card while its design read `basis`. */
export function noteAnsweredHere(projectName: string, featureId: string, basis: string | undefined): void {
  answered.set(projectName, new Map(answered.get(projectName) ?? NONE).set(featureId, basis));
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The features of the project answered on the card, live. */
export function useAnsweredHere(projectName: string): AnsweredHere {
  return useSyncExternalStore(subscribe, () => answered.get(projectName) ?? NONE);
}

/**
 * Whether every out-of-date feature is out of date only because of an answer
 * given here: each was answered on the card and has not been designed since
 * (its basis is still the one it had then). An empty list is not.
 */
export function outOfDateByAnswers(
  outOfDate: readonly string[],
  here: AnsweredHere,
  designedFrom: Readonly<Record<string, string>>,
): boolean {
  return outOfDate.length > 0 && outOfDate.every((id) => here.has(id) && here.get(id) === designedFrom[id]);
}
