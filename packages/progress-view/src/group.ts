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

// Who produced a line, and how a fan-out is arranged for reading.

import { subagentReportFromResult, type ProgressLineView, type SubagentReport } from "./format.js";

/** The attribution fields the runner stamps on a forwarded line. */
export interface AttributedLine {
  emitter?: string | undefined;
  emitterId?: string | undefined;
  emitterLabel?: string | undefined;
  toolUseId?: string | undefined;
}

/** A line as the grouping reads it: its payload plus who produced it. */
export type GroupableLine = ProgressLineView & AttributedLine;

export interface SubagentGroup<L> {
  id: string;
  label: string;
  /** The subagent's own steps — its closing report is in `report`, not here. */
  lines: L[];
  report: SubagentReport;
}

export type LogRow<L> = { kind: "line"; line: L } | { kind: "group"; group: SubagentGroup<L> };

/**
 * Split a cycle's output into the main agent's own lines plus one section per
 * subagent it fanned out to.
 *
 * A cycle can run several subagents at once, and their lines arrive
 * interleaved — read flat, three components' work reads as one agent
 * contradicting itself. Each subagent's lines are therefore collected into a
 * single section, placed at the point its FIRST line appeared, so the fan-out
 * still reads in the order it happened while each subagent's work stays
 * contiguous.
 *
 * Each section also carries a one-line `report`: what the subagent is doing now
 * while it runs, and the SDK's authoritative totals once it settles. That is
 * what a collapsed section shows, so choosing not to expand one still tells you
 * whether it worked.
 */
export function groupBySubagent<L extends GroupableLine>(lines: readonly L[]): LogRow<L>[] {
  const rows: LogRow<L>[] = [];
  const groups = new Map<string, SubagentGroup<L>>();
  for (const line of lines) {
    // Anything without a subagent id is the main agent's — including a
    // subagent line from a runner too old to stamp one, which is better read as
    // an ungrouped line than filed under a guessed owner.
    if (line.emitter !== "subagent" || !line.emitterId) {
      rows.push({ kind: "line", line });
      continue;
    }
    let group = groups.get(line.emitterId);
    if (!group) {
      group = {
        id: line.emitterId,
        label: line.emitterLabel ?? "subagent",
        lines: [],
        report: { label: line.emitterLabel ?? "subagent", status: "running" },
      };
      groups.set(line.emitterId, group);
      rows.push({ kind: "group", group });
    }
    // A label can arrive after the first line (an older feed, or a fan-out
    // whose description landed late); take the first real one offered.
    if (group.label === "subagent" && line.emitterLabel) {
      group.label = line.emitterLabel;
      group.report.label = line.emitterLabel;
    }

    // The subagent's own closing report is the section HEADER, not a row inside
    // it: the id it answers is the section's id, so it is about the whole
    // section rather than a step in it.
    if (line.kind === "tool_result" && line.toolUseId === group.id) {
      group.report = { ...subagentReportFromResult(line), label: group.label };
      continue;
    }
    // Likewise its narration: the intent phrase is the live status of a
    // collapsed section and never a row (see the runner's ActivityEvent).
    if (line.kind === "activity") {
      group.report.activity = line.summary;
      if (line.toolCount) group.report.toolCount = line.toolCount;
      continue;
    }
    group.lines.push(line);
  }
  return rows;
}

/**
 * One action and its outcome, for a surface that can hold both before drawing.
 *
 * The wire carries them as two events on purpose: an action is emitted the
 * instant the SDK yields it, BEFORE the command runs, which is what makes the
 * feed live. A cold `bal build` does not report its exit code for another 25
 * seconds. Delaying the action row until then would buy aligned rows at the
 * price of 25 seconds of silence per build, so merging is a renderer's job
 * rather than the wire's.
 *
 * A tool_result whose action was never seen (an evicted pending entry, a feed
 * joined mid-run) stays a row of its own — dropping it would hide a failure.
 */
export interface MergedRow<L> {
  line: L;
  outcome?: L | undefined;
}

export function mergeOutcomes<L extends GroupableLine>(lines: readonly L[]): MergedRow<L>[] {
  const rows: MergedRow<L>[] = [];
  const byToolUse = new Map<string, MergedRow<L>>();
  for (const line of lines) {
    if (line.kind === "tool_result" && line.toolUseId) {
      const action = byToolUse.get(line.toolUseId);
      if (action) {
        action.outcome = line;
        continue;
      }
    }
    const row: MergedRow<L> = { line };
    rows.push(row);
    // Only an ACTION claims the id: a tool_result kept as its own row must not
    // then swallow a later result, and the git_*/gh_action rewrites of a Bash
    // call are actions too, so they take their outcome the same way.
    if (line.kind !== "tool_result" && line.toolUseId) byToolUse.set(line.toolUseId, row);
  }
  return rows;
}
