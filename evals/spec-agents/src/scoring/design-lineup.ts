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
 * The design lineup's own rules (`skills/design`), as pure functions over the
 * files and the turn records: the order the artifacts are written in, the
 * shape of `decisions.md`, what the gap check may write into the
 * requirements, and how the run closes. `structural.ts` composes them into
 * the design section's checks.
 */

import type { TurnRecord } from "../tracing.js";

/** The artifact kinds of the lineup, in the order the design skill writes them. */
const LINEUP: Array<{ stage: string; matches: (path: string) => boolean }> = [
  { stage: "architecture (design.cell)", matches: (p) => p === "specs/design/design.cell" },
  { stage: "data model", matches: (p) => p === "specs/design/domain-model.md" },
  { stage: "roles and permissions", matches: (p) => p === "specs/design/security.json" },
  { stage: "prototype", matches: (p) => /^specs\/design\/components\/[^/]+\/prototype\.(json|tsx)$/.test(p) },
  { stage: "openapi.yaml", matches: (p) => /^specs\/design\/components\/[^/]+\/openapi\.yaml$/.test(p) },
  { stage: "agent.afm.md", matches: (p) => /^specs\/design\/components\/[^/]+\/agent\.afm\.md$/.test(p) },
  // A dependency's definition comes with the architecture; its contract and assumptions.md wait for the Dependencies step.
  {
    stage: "dependency contract or assumptions",
    matches: (p) => /^specs\/design\/dependencies\/[^/]+\/[^/]+$/.test(p) && !p.endsWith("/dependency.json"),
  },
  { stage: "flows", matches: (p) => /^specs\/design\/flows\/[^/]+\.md$/.test(p) },
  { stage: "acceptance tests", matches: (p) => /^specs\/validation\/acceptance\/[^/]+\.feature$/.test(p) },
];

/** The file tools whose `path` is a write (the design agent's `files` tool set). */
const WRITE_TOOLS = new Set(["addFile", "editFile"]);

/** The path of every write the run attempted, in order (a refused write included). */
export function writeLog(records: TurnRecord[]): string[] {
  return records.flatMap((rec) =>
    rec.toolCalls.flatMap((call) => {
      const path = (call.input as { path?: unknown } | undefined)?.path;
      return WRITE_TOOLS.has(call.toolName) && typeof path === "string" ? [path] : [];
    }),
  );
}

/** Every path the run wrote, each at the position of its FIRST write attempt. */
export function firstWrites(records: TurnRecord[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const [i, path] of writeLog(records).entries()) if (!first.has(path)) first.set(path, i);
  return first;
}

/**
 * Null when each lineup stage the run wrote started after every earlier
 * stage's files were first written; otherwise the first pair out of order. A
 * later edit of an earlier artifact (a fix, the grants pass) is not an order
 * fault, so only first writes count.
 */
export function lineupOrderProblem(records: TurnRecord[]): string | null {
  const writes = [...firstWrites(records)];
  const stages = LINEUP.map(({ stage, matches }) => {
    const positions = writes.filter(([path]) => matches(path));
    return { stage, positions };
  }).filter((s) => s.positions.length > 0);
  for (let a = 0; a < stages.length; a++) {
    for (let b = a + 1; b < stages.length; b++) {
      const late = stages[a]!.positions.reduce((m, p) => (p[1] > m[1] ? p : m));
      const early = stages[b]!.positions.reduce((m, p) => (p[1] < m[1] ? p : m));
      if (late[1] > early[1]) {
        return `${early[0]} (${stages[b]!.stage}) was first written before ${late[0]} (${stages[a]!.stage})`;
      }
    }
  }
  return null;
}

/** A decisions.md line: `- [tag] decision. *assumed* (F1, F2)` — the tag of the artifact it shapes, the features it serves. */
const DECISION_LINE = /^- \[([a-z0-9][a-z0-9-]*)\] \S.*?(?: \*assumed\*)? \(((?:F\d+)(?:, ?F\d+)*|all)\)\s*$/;
const ARTIFACT_TAGS = new Set(["architecture", "data-model", "security", "flows"]);

/**
 * Every problem with `specs/design/decisions.md` (empty when it holds one line
 * per decision, each tagged with an artifact or a component, each naming the
 * features it serves). Headings and blank lines are free; any other line is
 * a problem, and so is a file with no decision at all.
 */
export function decisionsProblems(content: string, components: string[]): string[] {
  if (!content.trim()) return ["specs/design/decisions.md missing or empty"];
  const tags = new Set([...ARTIFACT_TAGS, ...components]);
  const problems: string[] = [];
  let decisions = 0;
  for (const [n, raw] of content.split("\n").entries()) {
    const line = raw.trimEnd();
    if (line === "" || line.startsWith("#")) continue;
    const m = DECISION_LINE.exec(line);
    if (!m) {
      problems.push(`line ${n + 1} is not "- [tag] decision. *assumed* (F<n>, …)": ${line.slice(0, 120)}`);
      continue;
    }
    decisions++;
    if (!tags.has(m[1]!)) problems.push(`line ${n + 1}: [${m[1]}] is neither an artifact tag nor a component`);
  }
  if (decisions === 0) problems.push("no decision line");
  return problems;
}

const LIST_ITEM = /^\s*(?:-|\d+\.)\s+\S/;

/** The list-item lines of a markdown file, each with the `## ` section it sits in. */
function listItems(md: string): Array<{ section: string; line: string }> {
  let section = "";
  const out: Array<{ section: string; line: string }> = [];
  for (const raw of md.split("\n")) {
    const heading = /^##\s+(.*)$/.exec(raw);
    if (heading) {
      section = heading[1]!.trim();
      continue;
    }
    if (LIST_ITEM.test(raw)) out.push({ section, line: raw.trim() });
  }
  return out;
}

/**
 * What the gap check may do to a requirements file (`skills/design`, "The gap
 * check"): add lines. A line it adds outside Open Questions is a decision the
 * agent made, closed by `*assumed*`; a question goes to Open Questions. A
 * line removed or reworded is a requirement the design changed on its own.
 * Each argument maps a repo-relative requirements path to its text.
 */
export function gapCheckProblems(before: Record<string, string>, after: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const was = listItems(before[path] ?? "");
    const now = listItems(after[path] ?? "");
    const wasLines = new Set(was.map((i) => i.line));
    const nowLines = new Set(now.map((i) => i.line));
    for (const item of now) {
      if (wasLines.has(item.line) || /open questions/i.test(item.section)) continue;
      if (!item.line.includes("*assumed*")) problems.push(`${path}: added without *assumed*: ${item.line.slice(0, 120)}`);
    }
    for (const item of was) {
      // An answered question leaves Open Questions; nothing else may go.
      if (nowLines.has(item.line) || /open questions/i.test(item.section)) continue;
      problems.push(`${path}: removed or reworded: ${item.line.slice(0, 120)}`);
    }
  }
  return problems;
}

/**
 * Null when the run's last words point at the Design card (`skills/design`,
 * "Where this stops"): the next step is named there, and the questions are
 * counted, not listed in the chat.
 */
export function closingProblem(records: TurnRecord[]): string | null {
  const last = records.at(-1)?.agentText.trim() ?? "";
  if (!last) return "the run said nothing at the end";
  if (/^\s*(?:#+\s*)?(?:\*\*)?questions for you(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/im.test(last)) {
    return "the closing lists the questions in the chat (a \"Questions for you\" block)";
  }
  const tail = last.slice(-800);
  if (!/design card/i.test(tail)) return `the closing does not name the next step on the Design card: …${tail.slice(-200)}`;
  return null;
}
