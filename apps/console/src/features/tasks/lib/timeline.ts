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

import {
  formatLine as formatShared,
  formatOutcome as formatOutcomeShared,
  type LineTone,
  type ProgressLineView,
} from "@aep/progress-view";
import type { components } from "../../../generated/aep-api";

type TimelineEvent = components["schemas"]["TimelineEvent"];

/**
 * Identity of one timeline line — the replay-dedup key and the list key.
 * Structured runner events carry a per-execution monotonic seq. Plain runner
 * stdout wrapped by the BFF (agent_progress.go) arrives with seq 0 on every
 * line, so a bare executionId:seq key would collide and swallow all but the
 * first; those fall back to the line's K8s timestamp + text, which is
 * per-line unique and identical across reconnect replays of the same line.
 */
export function timelineEventKey(e: TimelineEvent): string {
  if (e.seq) return `${e.executionId}:${e.seq}`;
  return `${e.executionId}:0:${e.ts}:${e.summary ?? e.message ?? ""}`;
}

/**
 * The runner's progress envelope, minus whatever the transport attributes it
 * to. TimelineEvent (per-execution, task log) and RunProgressLine (per-cycle,
 * run feed) are the same envelope carried by two streams and differ only in
 * their attribution fields, so the formatter is written against the envelope
 * and both streams feed it.
 */
export type AgentLogLine = ProgressLineView;

// The wording of a line is shared with the playground (@aep/progress-view) so
// the fast local loop and a cluster run read identically — two formatters
// drifted once already. Only the mapping from semantic weight to the Oxygen
// palette is the console's, and it stays here.
const TONE_COLORS: Record<LineTone, string> = {
  default: "grey.300",
  muted: "grey.400",
  info: "info.light",
  success: "success.light",
  warn: "warning.light",
  error: "error.light",
};

/**
 * One console line per log line, formatted by kind (#173 decisions: flat log;
 * attempts are divider lines, not UI sections).
 *
 * An empty `text` means the line is deliberately silent — it exists on the wire
 * for a machine reader but has nothing worth a row (a fast, successful
 * tool_result). Renderers drop those rather than emitting a blank line.
 */
export function formatLine(e: AgentLogLine): { text: string; tone: string } {
  const { text, tone } = formatShared(e);
  return { text, tone: TONE_COLORS[tone] };
}

/**
 * What a call's outcome adds, as the trailing cell on its action's row.
 *
 * The console can do this and a terminal cannot: it holds every line in state,
 * so when the outcome arrives — 25 seconds after the action for a cold build —
 * it re-renders that row rather than printing a second one. One row per step.
 *
 * An empty `text` means the outcome carries nothing worth showing (a fast
 * success), which is the feed's governing rule, not a missing value.
 */
export function formatOutcome(e: AgentLogLine | undefined): { text: string; tone: string } {
  const { detail, duration, tone } = formatOutcomeShared(e);
  return { text: [detail, duration].filter(Boolean).join(" · "), tone: TONE_COLORS[tone] };
}
