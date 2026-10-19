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

import os from "node:os";
import type { RunEventInput } from "./emitter.js";
import { trimSummary } from "./adapter_common.js";

// --- paths ----------------------------------------------------------------------

/**
 * The two directories a reader's line shortens, each "" while unknown (which
 * leaves its paths exactly as the runtime gave them).
 *
 * `workspace` is the run's project, as the runtime declared it. `home` is the
 * runtime's home directory, where it keeps its OWN files — its session
 * transcripts under `.claude/projects/`, the toolchain caches — and which spends
 * the same ten characters on every row that reads one. The workspace sits
 * inside it on a cluster pod, so the workspace is always tried first.
 */
export interface PathRoots {
  workspace: string;
  home: string;
}

/**
 * A path inside the workspace, relative to it: the ~95-character root is the
 * same on every row and pushes the meaningful tail off the width. A path
 * outside stays absolute, since "outside" is the interesting fact. Matched on a
 * path boundary, so `<root>-old` is not a child.
 */
export function relativiseToWorkspace(path: string, root: string): string {
  if (!root || !path.startsWith("/")) return path;
  if (path === root) return ".";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/**
 * A path as a reader's line: workspace-relative inside the project, `~/…` under
 * the runtime's home, absolute anywhere else. `~` keeps "this left the project"
 * visible — which is why the home is not simply stripped the way the workspace
 * is — and it is the shell's own spelling of that directory, so the line still
 * names the same file.
 */
function readerPath(path: string, roots: PathRoots): string {
  const inWorkspace = relativiseToWorkspace(path, roots.workspace);
  if (inWorkspace !== path || !roots.home) return inWorkspace;
  if (path === roots.home) return "~";
  return path.startsWith(`${roots.home}/`) ? `~${path.slice(roots.home.length)}` : path;
}

// --- shell commands ----------------------------------------------------------

/** `s` with every RegExp metacharacter escaped, so a directory matches as text. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A shell command — or any free text that may quote one, or a path — as a
 * READER's line: the workspace root collapsed to `~ws`, so the tail survives
 * the width. `~ws` rather than nothing, so the line does not read as a command
 * someone could paste; a shell row's `command` keeps the exact text.
 *
 * The home directory then collapses to `~`, but only where it stands as a whole
 * path — at the start of a word and ending at a `/`, a quote, a space or the end
 * — so `/opt/home/aep` and `/home/aep-old` stay what they are. The workspace
 * goes first because it sits inside the home on a pod, and collapsing the home
 * first would leave `~/aep-workspace/…` where `~ws` belongs.
 *
 * NOT capped, and nothing else about the text changes: each field has its own
 * cap (a summary's 200, a report's 500) and applies it AFTER this, so the cap
 * spends itself on the meaningful tail. Exported because the runtime's own
 * prose quotes commands and paths too — a progress phrase is often "Running
 * <the command>", a failed call's output names the file it failed on — and the
 * contract's reader form holds for every line a reader sees, not only for the
 * rows composed here.
 */
export function readerText(cmd: string, roots: PathRoots): string {
  const shown = roots.workspace ? cmd.split(roots.workspace).join("~ws") : cmd;
  if (!roots.home) return shown;
  return shown.replace(new RegExp(`(?<![\\w.~/-])${escapeRegExp(roots.home)}(?=[/\\s'"]|$)`, "g"), "~");
}

/**
 * One run's two roots and the reader form of the runtime's own prose under
 * them, which every adapter needs the same way. The home is fixed at
 * construction: no message declares it, so it is the one root taken from
 * outside (the adapter's `homeDir` option, else this process's). The workspace
 * is the runtime DECLARING its cwd, so it is empty until the adapter hears it,
 * which leaves paths absolute rather than mis-relativised. Both are kept with
 * trailing slashes stripped, the one boundary form `readerText` matches, which
 * also turns a home of "/" into "unknown".
 */
export interface ReaderPaths {
  /** Both roots as they stand now. */
  roots(): PathRoots;
  /** The workspace root, once the runtime declares its cwd. */
  declareWorkspace(dir: string): void;
  /**
   * The runtime's own prose — a phrase, a label, a report, a plan title — in
   * reader form, uncapped. Its words quote commands: a progress phrase is
   * usually "Running <the Bash command>", and live (2026-10-12) a crew caption
   * read "Running cd /home/aep/aep-workspace/default/… && …". Only the two roots
   * change; the caller caps afterwards, as for every summary.
   */
  prose(text: string): string;
  /** `prose`, capped as a row's one line (a label, a phrase, a title). */
  line(text: string): string;
}

export function readerPaths(homeDir?: string): ReaderPaths {
  const home = (homeDir ?? os.homedir()).replace(/\/+$/, "");
  let workspace = "";
  const roots = (): PathRoots => ({ workspace, home });
  const prose = (text: string): string => readerText(text, roots());
  return {
    roots,
    declareWorkspace: (dir) => {
      workspace = dir.replace(/\/+$/, "");
    },
    prose,
    line: (text) => trimSummary(prose(text)),
  };
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
 * A tool input as a reader's line: the first of `fields` it carries as text (a
 * runtime lists its own argument spellings, most identifying first), shortened
 * by `readerPath` before the cap so the cap spends itself on the part that
 * names the file.
 *
 * A tool none of them fits says nothing here, and its row prints the tool's
 * name alone. This used to fall back to the input as JSON, on the theory that a
 * dump still surfaced an unknown tool — but the NAME already surfaces it, and
 * the dump was the raw arguments the contract keeps off the feed: live, a
 * `ToolSearch` row read `$ ToolSearch {"query":"select:…","max_results":3}`.
 */
export function summaryFromInput(input: unknown, fields: readonly string[], roots: PathRoots): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const candidate = fields.map((f) => o[f]).find((v): v is string => typeof v === "string" && v !== "");
  return candidate ? trimSummary(readerPath(candidate, roots)) : "";
}

/**
 * The reader's line a row carries: its `summary`, or — for a row that judged
 * the exact command enough on its own (`readerLine`) — that command, held to the
 * same one-line cap. This is what every renderer prints (`summary ?? command`),
 * so a backgrounded command's task events, which name the command again
 * minutes later, say it exactly as its launching row did.
 */
export function rowSummary(row: RunEventInput): string {
  return row.summary ?? trimSummary(row.command ?? "");
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
 * A command's paths are NOT relativised: after a `cd` a relative path would
 * resolve somewhere else, and `command` is the text a reader may re-run.
 *
 * The caller stamps `agentId` and `toolUseId` onto what comes back.
 */
export function shellEvents(command: string, roots: PathRoots, tool: string): RunEventInput[] {
  const cmd = command.trim();
  const shown = readerText(cmd, roots);
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
// Unanchored: compiler errors lead with a location
// (`src/main.tsx(13,44): error TS2307: …`).
const ANNOUNCES_FAULT = /\b(?:error|fatal|panic|exception|failed)\b/i;

/**
 * A trailing line that tells the reader what to do next (`gh`, `git`, `cargo`
 * and `npm` all end errors with one), skipped when walking back from the end
 * for a diagnosis.
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

/**
 * The failed call's own words, flattened to one line and bounded, in reader
 * form (`readerText`): a failure names the file it failed on, by its absolute
 * path.
 */
export function failureText(text: string, roots: PathRoots): string {
  const lines = outputLines(readerText(text, roots));
  if (lines.length === 0) return "";
  const kept = lines.slice(0, MAX_FAILURE_LINES);
  const dropped = lines.length - kept.length;
  const joined = kept.join(" | ") + (dropped > 0 ? ` (+${dropped} more line${dropped === 1 ? "" : "s"})` : "");
  return joined.length <= MAX_FAILURE_CHARS ? joined : joined.slice(0, MAX_FAILURE_CHARS - 1) + "…";
}

/**
 * The one-line diagnosis of a failed call, plus its exit code when the tool was
 * a shell that printed one. Everything else in the output is developer material
 * and belongs in the runtime's raw log, not in a progress feed. In reader form,
 * like `failureText`: a compiler's diagnosis leads with the absolute path of
 * the file it is about.
 */
export function failureDetail(text: string, roots: PathRoots): { exitCode?: number; summary: string } {
  const lines = outputLines(readerText(text, roots));
  if (lines.length === 0) return { summary: "" };

  const code = EXIT_CODE_LINE.exec(lines[0]);
  const rest = code ? lines.slice(1) : lines;
  let at = rest.findIndex((l) => ANNOUNCES_FAULT.test(l));
  // Nothing announced a fault: the LAST line, since shell output is a banner
  // then a diagnosis.
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
