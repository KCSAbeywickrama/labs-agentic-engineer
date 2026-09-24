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

// What a TOOL CALL becomes on the feed, for any runtime: a shell command read
// as the effect it had, a failed call's output read down to its diagnosis, and
// an authoring call's line delta.
//
// None of this reads a runtime's message shape. Each function takes the plain
// facts a translator has already pulled out of its own messages — a command
// line, a failed call's output text, the text an edit replaced — which is what
// lets every adapter share them. Two copies of "what a commit looks like" would
// drift, and a feed whose commits read differently depending on which runtime
// made them is the one thing the canonical events exist to prevent.

import type { RunEventInput } from "./emitter.js";
import { trimSummary } from "./adapter_common.js";

// --- paths ----------------------------------------------------------------------

/**
 * A path inside the workspace, said the way a reader of the workspace would say
 * it.
 *
 * The workspace root is ~95 characters of nothing — a mount point, an
 * environment name, a project handle and a UUID — and it is identical on every
 * row of a run. Live (2026-09-08) that pushed the only meaningful part of a
 * `Read` off the right edge and left ten consecutive reads looking like one
 * repeated line: `$ Read /home/aep/aep-workspace/default/employees-submit-…
 * /07f229c4-4e80-4168-9609-e5a4c4ff7f66/specs/design/security.json`.
 *
 * Two cases are deliberately left alone. A path OUTSIDE the workspace stays
 * absolute, because "outside" is the interesting half of that fact — the
 * runtime's own session directory under `$HOME/.claude/projects/…` reads as a
 * detour precisely because it does not start where the project does. And a path
 * under the workspace's own `.claude/` needs nothing special: relativised it
 * becomes `.claude/skills/aep/references/component-contract.md`, which is both
 * short and unambiguous about being tooling rather than the product.
 *
 * Matching is on a path boundary, so a sibling checkout at `<root>-old` is not
 * mistaken for a child of the root.
 */
export function relativiseToWorkspace(path: string, root: string): string {
  if (!root || !path.startsWith("/")) return path;
  if (path === root) return ".";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

// --- shell commands ----------------------------------------------------------

/**
 * A shell command as a READER's line: the workspace root collapsed to `~ws`.
 *
 * `command` keeps the exact text — see `shellEvents` — and this is the other
 * field the contract defines: "one line describing the call, composed by the
 * producer for a reader". A live run (2026-09-08) put 66 of 379 rows through the
 * feed carrying the same ~95-character prefix, and `agent_progress` then
 * truncated them to `Running cat /home/aep/aep-workspace/default/hello-world-s…`
 * — a row that says nothing at all. Collapsing the prefix is what makes the tail
 * survive the width.
 *
 * `~ws` rather than deleting the prefix outright: a bare `hello-webapp && npm
 * run build` would read as a command someone could paste, and it is not one.
 */
function commandForReader(cmd: string, root: string): string {
  if (!root) return cmd;
  return cmd.split(root).join("~ws");
}

/**
 * The second field, and ONLY when it earns its place.
 *
 * `command` and `summary` say different things — one is the line that ran, one
 * is the line a reader scans — but on a command with no workspace path in it
 * they are the same string, and sending both would put a duplicate on every row
 * of the feed. Every renderer reads `summary ?? command`, so one field is
 * enough whenever the collapse changed nothing.
 */
function readerLine(cmd: string, shown: string): { summary?: string } {
  return shown === cmd ? {} : { summary: trimSummary(shown) };
}

/**
 * A shell row's fields. `summary` alone while it says everything; `command`
 * joins it only once the two differ, and then carries the exact line — uncapped,
 * because the contract puts no ceiling on `command` and its whole purpose is to
 * be the text somebody can re-run.
 */
function shellFields(cmd: string, shown: string): { summary: string; command?: string } {
  return shown === cmd
    ? { summary: trimSummary(cmd) }
    : { summary: trimSummary(shown), command: cmd };
}

/**
 * What one shell command becomes on the feed.
 *
 * The three rewrites exist because a commit, a push and a `gh` call are the
 * run's EFFECTS — the things a reader scans a feed for — and they read as
 * effects rather than as shell only if the producer says which they are.
 *
 * `tool` is the runtime's own name for its shell tool, and it reaches only the
 * plain `tool_use` row: a row prints the name the runtime used, while the three
 * effects are named by the contract and by nothing a runtime spells.
 *
 * A command's absolute paths are NOT shortened the way a file tool's argument
 * is. The contract calls this field "the command line that ran", and a relative
 * path in it would be a claim that resolves only from the workspace root —
 * which is not where the command ran once an agent has `cd`-ed into a
 * component. Editing the text of a command a reader may re-run is the one place
 * brevity is worth less than truth.
 *
 * The caller stamps `agentId` and `toolUseId` onto what comes back.
 */
export function shellEvents(command: string, workspaceRoot: string, tool: string): RunEventInput[] {
  const cmd = command.trim();
  const shown = commandForReader(cmd, workspaceRoot);
  // git commit -m "..." or -F file
  if (/^git\s+commit\b/.test(cmd)) {
    const msgMatch = cmd.match(/-m\s+(['"])(.+?)\1/);
    return [{ kind: "git_commit", summary: msgMatch ? trimSummary(msgMatch[2]) : trimSummary(cmd) }];
  }
  // git push origin <branch> / git push -u origin <branch>
  if (/^git\s+push\b/.test(cmd)) {
    const tokens = cmd.split(/\s+/);
    const branch = tokens[tokens.length - 1];
    return [{
      kind: "git_push",
      ...(branch && branch !== "push" ? { branch } : {}),
      summary: trimSummary(shown),
    }];
  }
  // gh anything
  if (/^gh\s+/.test(cmd)) {
    return [{ kind: "gh_action", command: cmd, ...readerLine(cmd, shown) }];
  }
  return [{ kind: "tool_use", tool, ...shellFields(cmd, shown) }];
}

// --- a failed call's output ----------------------------------------------------

// A shell tool's own first line on a failed call, where the runtime reports the
// status that way (Claude Code's Bash does). Parsing it is not a guess at a
// format we do not own: this prefix is what that runtime writes, and it is the
// only place the process status appears. A runtime that reports the status as
// a field instead simply never produces the line, and nothing here misreads.
const EXIT_CODE_LINE = /^Exit code (\d+)\b/;

// A line that announces the fault, as opposed to the build chatter above it.
// `bal build` prints nine lines of dependency pulls before the first ERROR, so
// "the line after the exit code" would report "Compiling source" — technically
// the first line and useless as a diagnosis.
//
// Matched ANYWHERE in the line, not anchored at its start. Anchoring looked
// like the conservative choice and it excluded the commonest compiler-error
// shape there is — `src/main.tsx(13,44): error TS2307: …` puts the file first,
// so `^error` never fires and such a line only ever read well when it happened
// to also be the first line of output. Every diagnostic family this feed sees
// (tsc, javac, ballerina, gcc, a test runner's failure line) leads with a
// location. The cost of unanchoring is a prose line that merely mentions the
// word winning over the real one; the fallback below makes that the mild
// failure, since the tail of the output is where a diagnosis lives anyway.
const ANNOUNCES_FAULT = /\b(?:error|fatal|panic|exception|failed)\b/i;

/**
 * A trailing line that TELLS THE READER WHAT TO DO NEXT rather than saying what
 * went wrong. Skipped when walking back from the end for a diagnosis.
 *
 * This is the other half of the last-line rule, and it was learned the hard way.
 * Taking the last line fixed a live run's `--- expense-webapp dir ---`, and then
 * the very next run reported `Learn about accessibility experiences using
 * `gh help accessibility`` as the reason a `gh issue view` failed — gh prints
 * that footer after every error. `git`, `cargo` and `npm` all end the same way
 * ("See 'git help'", "For more information about this error…"), so the fault is
 * the LAST line that is not guidance, not the last line.
 */
const OFFERS_GUIDANCE =
  /^\s*(?:learn (?:more|about)\b|see\b|try\b|usage:|hint:|note:|for more info(?:rmation)?\b|run ['"`]|use ['"`])/i;

// How much of a failed spawned agent's error text reaches the feed. That case
// is not held to the one-line rule below: the text is the last copy of the
// reason (see `failureText`'s caller in the adapter).
const MAX_FAILURE_LINES = 10;
const MAX_FAILURE_CHARS = 2000;

/**
 * Output split into the lines a diagnosis can be chosen from.
 *
 * Takes TEXT: getting from a runtime's result shape to its text (content
 * blocks, error wrappers) is the adapter's job, and only the adapter knows it.
 */
function outputLines(text: string): string[] {
  return text
    .split("\n")
    // A progress bar rewrites its own line with \r; only the final state of it
    // is text. Without this, one `bal build` line arrives 40 columns wide with
    // eight stale copies of itself in front.
    .map((l) => (l.split("\r").pop() ?? "").trim())
    .filter((l) => l !== "");
}

/** The failed call's own words, flattened to one line and bounded. */
export function failureText(text: string): string {
  const lines = outputLines(text);
  if (lines.length === 0) return "";
  const kept = lines.slice(0, MAX_FAILURE_LINES);
  const dropped = lines.length - kept.length;
  const joined = kept.join(" | ") + (dropped > 0 ? ` (+${dropped} more line${dropped === 1 ? "" : "s"})` : "");
  return joined.length <= MAX_FAILURE_CHARS ? joined : joined.slice(0, MAX_FAILURE_CHARS - 1) + "…";
}

/**
 * The one-line diagnosis of a failed call, plus its exit code when the tool was
 * a shell that printed one. Everything else in the output is developer material
 * and belongs in the runtime's raw log, not in a progress feed.
 */
export function failureDetail(text: string): { exitCode?: number; summary: string } {
  const lines = outputLines(text);
  if (lines.length === 0) return { summary: "" };

  const code = EXIT_CODE_LINE.exec(lines[0]);
  const rest = code ? lines.slice(1) : lines;
  let at = rest.findIndex((l) => ANNOUNCES_FAULT.test(l));
  // Nothing announced a fault, so fall back to the LAST line rather than the
  // first. Shell output is a banner then a diagnosis: a compiler names its
  // sources, npm prints its version notice, a test runner lists what it ran,
  // and the sentence that explains the exit code comes last. Taking line 0 put
  // `--- expense-webapp dir ---` and `import React from 'react';` on the feed
  // as two of four failure diagnoses in one live run (2026-09-08) — an echoed
  // heading and the first line of a file the command had cat'd.
  if (at < 0) {
    // Walk back past the tool's closing advice to the last line that states
    // something. If a command printed nothing BUT guidance, the last line is
    // still better than nothing.
    let end = rest.length - 1;
    while (end > 0 && (rest[end] === "" || OFFERS_GUIDANCE.test(rest[end]))) end--;
    at = end;
  }
  let diagnosis = rest[at] ?? "";
  // A line ending in a colon is introducing the next one, not stating anything
  // ("InputValidationError: Read failed due to the following issue:" — the issue
  // itself is below). Taking one without the other reports a heading.
  if (diagnosis.endsWith(":") && rest[at + 1]) diagnosis = `${diagnosis} ${rest[at + 1]}`;
  return {
    ...(code ? { exitCode: Number(code[1]) } : {}),
    summary: trimSummary(diagnosis),
  };
}

// --- line deltas ---------------------------------------------------------------

/** What one authoring call adds and removes, in lines. */
export interface LineDelta {
  added: number;
  removed: number;
}

/** Lines a piece of authored text accounts for. `""` is no lines, not one. */
function lineCount(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
}

/** A whole file written: every line is added, nothing is known to be removed. */
export function writeDelta(content: string): LineDelta {
  return { added: lineCount(content), removed: 0 };
}

/**
 * An exact-text replacement: the text it puts in and the text it takes out,
 * which makes the two counts a real delta rather than a whole-file diff.
 */
export function editDelta(oldText: string, newText: string): LineDelta {
  return { added: lineCount(newText), removed: lineCount(oldText) };
}
