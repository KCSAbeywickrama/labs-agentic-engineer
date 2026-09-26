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
 * verbatim, and some parts only make sense to the provider that produced them:
 * a provider-executed tool call (Anthropic's `web_search`) has no result
 * message another host would accept, and reasoning is signed or shaped for
 * the host that wrote it. Each turn's journal entry names the connection that
 * wrote it (`TurnJournalEntry.connection`), so the filter touches only the
 * turns another connection wrote and leaves a single-connection conversation
 * byte-identical, which keeps its prompt cache.
 */

import type { ModelMessage } from "ai";
import type { TurnJournalEntry } from "../store/conversation-store.js";

/**
 * The fingerprint a turn counts as when no journal entry states one: journaled
 * before fingerprints existed, or sent with no journal at all. Every turn from
 * before connections ran on Anthropic's API; a journal-less turn after them
 * that ran elsewhere is at worst filtered on its own connection, which drops
 * only its reasoning. A fixed fact about stored data, so it does not follow
 * the service's current default connection.
 */
const UNSTAMPED_TURN_CONNECTION = "anthropic@api.anthropic.com";

/**
 * The messages to send `current` (a `connectionFingerprint`).
 *
 * When every turn's fingerprint equals `current` this returns `messages`
 * ITSELF, so the prompt is byte-identical. Otherwise it returns a filtered
 * COPY: in the turns another connection wrote — and only those — reasoning
 * parts, provider-executed tool calls and their results are dropped, and a
 * message left with no content goes with them; text, client tool calls and
 * their results stay. Deterministic, so after a switch the cleaned prefix is
 * the same on every turn and caches again from the second.
 *
 * A turn is the run of messages from one user message to the next: a turn
 * appends exactly one user message, first. The caller must not treat the
 * returned array as the transcript — it may be a copy.
 */
export function historyFor(
  messages: ModelMessage[],
  journal: readonly Pick<TurnJournalEntry, "messageIndex" | "connection">[],
  current: string,
): ModelMessage[] {
  const stamped = new Map<number, string>();
  for (const entry of journal) {
    if (entry.connection !== undefined) stamped.set(entry.messageIndex, entry.connection);
  }
  let turnConnection = UNSTAMPED_TURN_CONNECTION;
  const foreign = messages.map((m, index) => {
    if (m.role === "user") turnConnection = stamped.get(index) ?? UNSTAMPED_TURN_CONNECTION;
    return turnConnection !== current;
  });
  if (!foreign.includes(true)) return messages;
  return messages.flatMap((m, index) => {
    if (!foreign[index]) return [m];
    const cleaned = replayableOn(m);
    return cleaned ? [cleaned] : [];
  });
}

/**
 * `m` without the parts only its own connection can replay; undefined when
 * nothing is left. Only assistant messages carry such parts: a tool result in
 * an assistant message is always a provider-executed one (a client tool's
 * result is a `tool` message), and a `custom` part is provider-specific by
 * definition.
 */
function replayableOn(m: ModelMessage): ModelMessage | undefined {
  if (m.role !== "assistant" || typeof m.content === "string") return m;
  const content = m.content.filter((part) => {
    switch (part.type) {
      case "reasoning":
      case "reasoning-file":
      case "custom":
      case "tool-result":
        return false;
      case "tool-call":
        return part.providerExecuted !== true;
      default:
        return true;
    }
  });
  if (content.length === m.content.length) return m;
  return content.length > 0 ? { ...m, content } : undefined;
}
