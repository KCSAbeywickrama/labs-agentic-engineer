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
 * The history filter: which stored parts of a conversation the current
 * connection can replay. The store keeps every turn's `ModelMessage[]`
 * verbatim, and some parts only make sense to the provider that produced them
 * (provider-executed tool calls such as Anthropic's `web_search`, signed
 * reasoning). Each turn's journal entry names the connection that wrote it
 * (`TurnJournalEntry.connection`), so the filter touches only the turns another
 * connection wrote and leaves a single-connection conversation byte-identical,
 * which keeps its prompt cache.
 */

import type { ModelMessage } from "ai";
import type { TurnJournalEntry } from "../store/conversation-store.js";

/**
 * The fingerprint a turn journaled before fingerprints existed counts as: every
 * such turn ran on Anthropic's API. A fixed fact about stored data, so it does
 * not follow the service's current default connection.
 */
const UNSTAMPED_TURN_CONNECTION = "anthropic@api.anthropic.com";

/**
 * The messages to send `current` (a `connectionFingerprint`). When every turn's
 * fingerprint equals `current` this returns `messages` ITSELF, not a copy:
 * `runTurn` appends the new turn to the array it is handed, and the caller
 * saves `conv.messages`, so identity is what keeps the turn in the transcript.
 *
 * Turns from another connection are replayed as stored for now. Filtering them
 * (provider-executed tool calls, their results and reasoning parts dropped from
 * those turns only) returns a copy, and that copy must not become the append
 * target.
 */
export function historyFor(
  messages: ModelMessage[],
  journal: readonly Pick<TurnJournalEntry, "connection">[],
  current: string,
): ModelMessage[] {
  if (journal.every((turn) => (turn.connection ?? UNSTAMPED_TURN_CONNECTION) === current)) return messages;
  // Another connection wrote some turns: sent as stored, unfiltered.
  return messages;
}
