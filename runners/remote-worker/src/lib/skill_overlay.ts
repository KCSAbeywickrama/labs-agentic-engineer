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

// Applies a mode overlay to an authored SKILL.md.
//
// The `aep` skill in the repo-root library is the PLATFORM run, written plainly:
// a repo clone, the issues API, a branch, one pull request. The playground runs
// the same agent on a plain project directory with `issues/*.md` and no remote,
// and the handful of passages where that genuinely differs live in
// `skills/aep/overlays/local.md` as anchored edits, which this module applies at
// session start. See ADR-0004.
//
// Why an overlay and not markers in the skill: the library is the one place
// skills are authored, and a reader (or a human who installs the plugin) should
// see the platform's procedure, not a document interleaved with a second
// audience's. Why not a TypeScript table of edits: the payloads are markdown
// prose thick with backticks and fenced blocks, and they must stay editable
// through the same `skills/` mount the playground already has — a `.ts` file
// under `src/` is baked into the runner image.
//
// Why the strictness below: the overlay's whole risk is a **silent** miss. An
// anchor that matches nothing would leave the platform's `gh`/PR procedure in a
// local session, which is the failure the previous marker-based design existed
// to prevent (ADR-0001 decision 7). So every directive must match exactly once,
// and anything this parser does not understand is an error — never a no-op.

/** One edit an overlay makes to a SKILL.md. */
export type OverlayDirective =
  | { kind: "replace-section"; heading: string; payload: string; line: number }
  | { kind: "append-section"; heading: string; payload: string; line: number }
  | { kind: "drop-section"; heading: string; line: number }
  | { kind: "replace-text"; find: string; replacement: string; line: number };

// Directives sit at column 0 so the grammar can be documented inside the overlay
// itself: the examples in its header are indented, and therefore prose.
const DIRECTIVE_LINE = /^<!--\s*([a-z-]+|\/replace-text)\s*(?::\s*(.*?)\s*)?-->$/;
const ANY_COMMENT_LINE = /^<!--.*-->$/;
const SECTION_KINDS = ["replace-section", "append-section", "drop-section"] as const;
const HEADING = /^(#{1,6})\s+\S/;
const FENCE = /^\s*(```|~~~)/;

type SectionKind = (typeof SECTION_KINDS)[number];

function isSectionKind(name: string): name is SectionKind {
  return (SECTION_KINDS as readonly string[]).includes(name);
}

/**
 * Parse an overlay file into its directives, in file order.
 *
 * Everything before the first directive is the overlay's own documentation and
 * is ignored. A payload is every line between one directive and the next,
 * stripped of leading and trailing blank lines (never of indentation — a payload
 * that sits inside a list item carries its own).
 *
 * Throws on anything unrecognised: an unknown directive name, a section
 * directive with no heading, a `drop-section` that carries a payload, an
 * unterminated `replace-text`, or a bare comment line at column 0. Silence is
 * the one behaviour an overlay parser must not have.
 */
export function parseOverlay(source: string, sourceName = "overlay.md"): OverlayDirective[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: OverlayDirective[] = [];

  // The directive currently collecting payload lines, if any.
  let open:
    | { kind: SectionKind; heading: string; line: number; body: string[] }
    | { kind: "replace-text"; line: number; find: string[]; replacement: string[]; half: "find" | "with" }
    | undefined;

  // Annotated on the variable, not just the arrow: that is what makes TypeScript
  // treat a call to it as terminating control flow, so the narrowing below holds.
  const fail: (lineNo: number, msg: string) => never = (lineNo, msg) => {
    throw new Error(`${sourceName}:${lineNo}: ${msg}`);
  };

  const closeOpen = (atLine: number): void => {
    if (!open) return;
    if (open.kind === "replace-text") {
      if (open.half === "find") {
        fail(open.line, "replace-text has no <!-- with --> half");
      }
      fail(open.line, "replace-text is not closed by <!-- /replace-text -->");
    }
    const payload = trimBlankEdges(open.body).join("\n");
    if (open.kind === "drop-section") {
      if (payload !== "") {
        fail(atLine, `drop-section: ${open.heading} carries a payload — use replace-section to substitute text`);
      }
      out.push({ kind: "drop-section", heading: open.heading, line: open.line });
    } else if (payload === "") {
      fail(open.line, `${open.kind}: ${open.heading} has an empty payload`);
    } else {
      out.push({ kind: open.kind, heading: open.heading, payload, line: open.line });
    }
    open = undefined;
  };

  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;
    const match = DIRECTIVE_LINE.exec(line);

    if (!match) {
      // A column-0 comment that is not a directive is a typo, not prose: prose
      // in this file is either indented (the grammar examples) or plain text.
      if (ANY_COMMENT_LINE.test(line)) {
        fail(lineNo, `unrecognised overlay directive: ${line.trim()}`);
      }
      if (open?.kind === "replace-text") {
        (open.half === "find" ? open.find : open.replacement).push(line);
      } else if (open) {
        open.body.push(line);
      }
      continue;
    }

    const name = match[1] ?? "";
    const argument = match[2];

    if (name === "with") {
      if (open?.kind !== "replace-text") fail(lineNo, "<!-- with --> outside a replace-text directive");
      if (open.half === "with") fail(lineNo, "replace-text has two <!-- with --> halves");
      open.half = "with";
      continue;
    }

    if (name === "/replace-text") {
      if (open?.kind !== "replace-text") fail(lineNo, "<!-- /replace-text --> with no replace-text open");
      if (open.half === "find") fail(open.line, "replace-text has no <!-- with --> half");
      const find = trimBlankEdges(open.find).join("\n");
      if (find === "") fail(open.line, "replace-text has an empty find half");
      out.push({
        kind: "replace-text",
        find,
        replacement: trimBlankEdges(open.replacement).join("\n"),
        line: open.line,
      });
      open = undefined;
      continue;
    }

    closeOpen(lineNo);

    if (name === "replace-text") {
      if (argument !== undefined) fail(lineNo, "replace-text takes no argument — put the text on the lines below");
      open = { kind: "replace-text", line: lineNo, find: [], replacement: [], half: "find" };
      continue;
    }

    if (!isSectionKind(name)) {
      fail(lineNo, `unknown overlay directive "${name}"`);
    }
    if (argument === undefined || argument === "") {
      fail(lineNo, `${name} needs a heading, e.g. <!-- ${name}: ## Where you are -->`);
    }
    if (!HEADING.test(argument)) {
      fail(lineNo, `${name}: "${argument}" is not a markdown heading (expected leading #)`);
    }
    open = { kind: name as SectionKind, heading: argument, line: lineNo, body: [] };
  }

  closeOpen(lines.length);

  if (out.length === 0) {
    throw new Error(`${sourceName}: no directives — an overlay that changes nothing is a mistake`);
  }
  return out;
}

/**
 * Apply `directives` to `skillMd`, in order, and return the result.
 *
 * Every directive must resolve to exactly one place in the document. A heading
 * that appears twice is as much of an error as one that appears not at all: the
 * overlay would silently patch the first and leave the second.
 */
export function applyOverlay(
  skillMd: string,
  directives: readonly OverlayDirective[],
  sourceName = "overlay.md",
): string {
  let text = skillMd.replace(/\r\n/g, "\n");

  for (const directive of directives) {
    const where = `${sourceName}:${directive.line}`;
    if (directive.kind === "replace-text") {
      text = applyReplaceText(text, directive, where);
      continue;
    }
    text = applySectionEdit(text, directive, where);
  }

  return collapseBlankRuns(text.split("\n")).join("\n");
}

function applyReplaceText(
  text: string,
  directive: Extract<OverlayDirective, { kind: "replace-text" }>,
  where: string,
): string {
  const { find, replacement } = directive;
  const occurrences = countOccurrences(text, find);
  if (occurrences !== 1) {
    throw new Error(
      `${where}: replace-text matched ${occurrences} times (expected exactly 1) — the skill's wording moved; re-anchor it:\n${indent(find)}`,
    );
  }
  const at = text.indexOf(find);
  // A match must start a line. Anchors are whole lines by construction, and a
  // mid-line match would mean the anchor is a fragment of a longer sentence —
  // exactly the kind of accidental hit this module exists to rule out.
  if (at !== 0 && text[at - 1] !== "\n") {
    throw new Error(`${where}: replace-text matched mid-line — anchor whole lines only:\n${indent(find)}`);
  }
  const end = at + find.length;
  // A deletion takes the newline with it, so removing a line out of a list item
  // or a fenced block doesn't leave a blank one behind.
  const dropTrailingNewline = replacement === "" && text[end] === "\n";
  return text.slice(0, at) + replacement + text.slice(dropTrailingNewline ? end + 1 : end);
}

function applySectionEdit(
  text: string,
  directive: Extract<OverlayDirective, { kind: SectionKind }>,
  where: string,
): string {
  const lines = text.split("\n");
  const { headingIndex, bodyEnd } = findSection(lines, directive.heading, where);
  assertLeafSection(lines, directive, headingIndex, bodyEnd, where);

  switch (directive.kind) {
    case "drop-section":
      // Heading included: a heading with no body reads as an unfinished section.
      lines.splice(headingIndex, bodyEnd - headingIndex);
      return lines.join("\n");
    case "replace-section":
      lines.splice(headingIndex + 1, bodyEnd - headingIndex - 1, "", ...directive.payload.split("\n"), "");
      return lines.join("\n");
    case "append-section":
      lines.splice(bodyEnd, 0, "", ...directive.payload.split("\n"), "");
      return lines.join("\n");
  }
}

/**
 * A section edit may only span a leaf section — one holding no further heading.
 *
 * This is the one way a directive can go wrong *silently*. A section runs to the
 * next heading of the same or higher level, so a heading that gets RENAMED
 * elsewhere in the skill (not removed — that throws) can widen an earlier
 * directive's range over the section below it. The anchor still matches exactly
 * once, the composed body loses a whole section, and nothing reports it. Live
 * example this rules out: rename `### Be idempotent` and
 * `replace-section: ### The record` starts swallowing it, while the overlay's
 * own `replace-text` anchor inside that section keeps matching.
 *
 * Widening the range is never what the author meant: a payload written for one
 * section cannot also be the right text for the section beneath it. So the fix
 * is always to add a directive per subsection, which is also the more legible
 * overlay.
 */
function assertLeafSection(
  lines: readonly string[],
  directive: Extract<OverlayDirective, { kind: SectionKind }>,
  headingIndex: number,
  bodyEnd: number,
  where: string,
): void {
  let inFence = false;
  for (let i = headingIndex + 1; i < bodyEnd; i += 1) {
    const line = lines[i] as string;
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence || !HEADING.test(line)) continue;
    throw new Error(
      `${where}: ${directive.kind}: "${directive.heading}" spans a nested heading "${line.trim()}" — ` +
        `the skill's structure moved. Anchor each subsection with its own directive.`,
    );
  }
}

interface SectionRange {
  headingIndex: number;
  /** Index one past the section's last line (its next same-or-higher heading, or EOF). */
  bodyEnd: number;
}

/**
 * Locate the section a heading opens. `heading` is the full heading line
 * (`### The set`), matched exactly — a heading inside a fenced code block is not
 * a heading, which matters here: the skill's `git log` snippet contains a
 * `# re-verify, then:` comment line.
 */
function findSection(lines: readonly string[], heading: string, where: string): SectionRange {
  const level = (HEADING.exec(heading)?.[1] ?? "#").length;
  const matches: number[] = [];
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && line.trimEnd() === heading) matches.push(index);
  }
  if (matches.length !== 1) {
    throw new Error(
      `${where}: heading "${heading}" appears ${matches.length} times in the skill (expected exactly 1)`,
    );
  }
  const headingIndex = matches[0] as number;
  const nextHeading = new RegExp(`^#{1,${level}}\\s+\\S`);
  let bodyEnd = lines.length;
  inFence = false;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && nextHeading.test(line)) {
      bodyEnd = i;
      break;
    }
  }
  return { headingIndex, bodyEnd };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    count += 1;
  }
  return count;
}

function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] as string).trim() === "") start += 1;
  while (end > start && (lines[end - 1] as string).trim() === "") end -= 1;
  return lines.slice(start, end);
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

/**
 * Collapse runs of blank lines to one, outside fenced code blocks. A section
 * edit can leave two blank lines where the payload met the surrounding prose;
 * the composed body should read like hand-written markdown either way.
 */
function collapseBlankRuns(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let blanks = 0;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      blanks += 1;
      if (blanks > 1) continue;
    } else {
      blanks = 0;
    }
    out.push(line);
  }
  return out;
}
