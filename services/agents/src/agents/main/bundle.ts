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
 * FileBundle — the in-memory spec bundle the main agent mutates for one turn.
 *
 * The whole point of this module is LATENCY: the files are already inlined in
 * the agent's prompt (free, prefill-cached), so re-emitting a file body to
 * change two lines is the expensive thing. `editFile` is an anchored
 * search/replace whose output cost scales with the EDIT, not the file. See
 * design.md for the full rationale.
 *
 * Design invariants this class enforces (pure, no I/O, fully testable):
 *  - Matching is LITERAL substring with NO structural normalization, so
 *    indentation in YAML / frontmatter is load-bearing and preserved byte for
 *    byte. The only normalization is CRLF -> LF (newlines are not meaningful
 *    in this corpus). All content is stored LF-canonical.
 *  - An edit must match EXACTLY ONCE; ambiguity returns the line number + text
 *    of every candidate so the model re-anchors in one corrective step.
 *  - Every op is idempotent: a repeated/duplicated call returns an
 *    `already-applied` / `noop` SUCCESS, never a loop-wedging hard error.
 *  - Writes to YAML / frontmatter files run a parse-only reparse guard; on
 *    failure the bundle is left byte-for-byte unchanged (reject, don't corrupt).
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Structural root files the demo refuses to delete. */
const PROTECTED_PATHS = new Set<string>([
  "specs/requirements/requirements.md",
  "specs/design/design.md",
]);

/** Leading YAML frontmatter fence: `---\n<block>\n---`. */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export type Op = "add" | "edit" | "remove" | "frontmatter";

export type ErrCode =
  | "ALREADY_EXISTS"
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "NOT_UNIQUE"
  | "NO_SUCH_FILE"
  | "EMPTY_OLD_STRING"
  | "INVALID_YAML"
  | "NO_FRONTMATTER"
  | "PROTECTED_PATH";

export interface OpOk {
  ok: true;
  path: string;
  op: Op;
  /** `applied` = state changed; `already-applied`/`noop` = idempotent no-change. */
  status: "applied" | "already-applied" | "noop";
  /** Post-op content ("" for a removed file). */
  newContent: string;
  /**
   * Set in `warn` yamlMode when the applied content is not valid YAML: the edit
   * still landed (disk-mode option B — leave the bytes), but the caller should
   * surface this. Absent in `reject` mode, where invalid YAML is a hard error.
   */
  warning?: string;
}

/**
 * How invalid post-edit YAML is handled. `reject` (default) leaves the bundle
 * byte-for-byte unchanged and returns INVALID_YAML — the safe in-memory
 * contract. `warn` applies the edit anyway and tags the result with `warning`
 * — used in disk mode, where the bytes are already streamed to the real file.
 */
export type YamlMode = "reject" | "warn";

export interface MatchCandidate {
  line: number;
  text: string;
}

export interface OpErr {
  ok: false;
  path: string;
  op: Op;
  code: ErrCode;
  message: string;
  /** Populated for NOT_UNIQUE / NOT_FOUND to steer one-step re-anchoring. */
  candidates?: MatchCandidate[];
  count?: number;
}

export type OpResult = OpOk | OpErr;

const MAX_CANDIDATES = 6;

export class FileBundle {
  private files = new Map<string, string>();
  private touchedPaths = new Set<string>();
  private yamlMode: YamlMode;

  constructor(initial: Record<string, string> = {}, opts: { yamlMode?: YamlMode } = {}) {
    this.yamlMode = opts.yamlMode ?? "reject";
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, lf(content));
    }
  }

  // -- Reads --------------------------------------------------------------

  has(path: string): boolean {
    return this.files.has(path);
  }

  read(path: string): string | undefined {
    return this.files.get(path);
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  touched(): string[] {
    return [...this.touchedPaths];
  }

  // -- Ops ----------------------------------------------------------------

  addFile(path: string, content: string): OpResult {
    const op: Op = "add";
    if (!path.trim()) {
      return err(path, op, "INVALID_PATH", "path must be a non-empty string.");
    }
    const next = lf(content);
    if (this.files.has(path)) {
      if (this.files.get(path) === next) {
        return ok(path, op, "noop", next); // identical re-add
      }
      return err(
        path,
        op,
        "ALREADY_EXISTS",
        `${path} already exists — use editFile to change it, or removeFile then addFile to replace it wholesale.`,
      );
    }
    return this.commit(path, op, next, (e) => `${path} would not be valid YAML: ${e}`);
  }

  editFile(path: string, oldString: string, newString: string): OpResult {
    const op: Op = "edit";
    if (!this.files.has(path)) {
      return err(
        path,
        op,
        "NO_SUCH_FILE",
        `${path} is not in the bundle. Available: ${this.list().join(", ")}.`,
      );
    }
    if (oldString === "") {
      return err(path, op, "EMPTY_OLD_STRING", "oldString must be non-empty; to create a file use addFile.");
    }
    const content = this.files.get(path)!; // already LF
    const oldS = lf(oldString);
    const newS = lf(newString);

    const starts = occurrences(content, oldS);
    if (starts.length === 0) {
      // Idempotency: treat as already-applied only when newString is present at
      // a UNIQUE site. A loose substring test would mask a genuine NOT_FOUND
      // (e.g. a short newString that coincidentally occurs inside another word),
      // silently dropping a requested change — worse than a corrective retry.
      if (newS.trim() !== "" && occurrences(content, newS).length === 1) {
        return ok(path, op, "already-applied", content);
      }
      return err(
        path,
        op,
        "NOT_FOUND",
        `oldString did not match any text in ${path}. Copy the snippet verbatim, including leading indentation and newlines.`,
        closestLines(content, oldS),
      );
    }
    if (starts.length > 1) {
      return err(
        path,
        op,
        "NOT_UNIQUE",
        `oldString matched ${starts.length} locations in ${path}. Broaden it with surrounding lines (e.g. the parent YAML key or the preceding heading) until it is unique.`,
        starts.slice(0, MAX_CANDIDATES).map((idx) => lineCandidate(content, idx)),
        starts.length,
      );
    }

    const idx = starts[0]!;
    // slice-based splice avoids String.replace's `$`-pattern interpretation.
    const after = content.slice(0, idx) + newS + content.slice(idx + oldS.length);

    return this.commit(
      path,
      op,
      after,
      (e) =>
        `Edit rejected — result would not be valid YAML: ${e}. The file is unchanged; fix the indentation of newString and retry.`,
    );
  }

  /**
   * Locate a UNIQUE occurrence of `oldString` for the disk-streaming splice
   * preview (run.ts) — returns the surrounding text, or null when the anchor is
   * absent or ambiguous (nothing is streamed; editFile()'s result then carries
   * the authoritative NOT_FOUND / NOT_UNIQUE error). Shares the exact matching
   * (CRLF-normalized, non-overlapping) with editFile, so the live preview can
   * never diverge from the bytes editFile commits.
   */
  locate(path: string, oldString: string): { head: string; tail: string } | null {
    const content = this.files.get(path);
    if (content === undefined || oldString === "") return null;
    const oldS = lf(oldString);
    const starts = occurrences(content, oldS);
    if (starts.length !== 1) return null;
    const idx = starts[0]!;
    return { head: content.slice(0, idx), tail: content.slice(idx + oldS.length) };
  }

  removeFile(path: string): OpResult {
    const op: Op = "remove";
    if (PROTECTED_PATHS.has(path)) {
      return err(path, op, "PROTECTED_PATH", `${path} is a structural root and cannot be deleted.`);
    }
    if (!this.files.has(path)) {
      return ok(path, op, "noop", ""); // idempotent delete
    }
    this.files.delete(path);
    this.touchedPaths.add(path);
    return ok(path, op, "applied", "");
  }

  setFrontmatterField(
    path: string,
    key: string,
    value: string | number | boolean | string[],
  ): OpResult {
    const op: Op = "frontmatter";
    if (!this.files.has(path)) {
      return err(
        path,
        op,
        "NO_SUCH_FILE",
        `${path} is not in the bundle. Available: ${this.list().join(", ")}.`,
      );
    }
    const content = this.files.get(path)!;
    const m = FRONTMATTER_RE.exec(content);
    if (!m) {
      return err(
        path,
        op,
        "NO_FRONTMATTER",
        `${path} has no leading --- frontmatter fence; use editFile instead.`,
      );
    }
    let fm: Record<string, unknown>;
    try {
      const parsed = parseYaml(m[1]!);
      fm = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch (e) {
      return err(path, op, "INVALID_YAML", `existing frontmatter is not valid YAML: ${msg(e)}`);
    }

    fm[key] = value; // preserves existing key order; new keys are appended
    const body = content.slice(m[0]!.length);
    const block = stringifyYaml(fm).replace(/\n+$/, "");
    const next = `---\n${block}\n---\n${body}`;

    return this.commit(path, op, next, (e) => `frontmatter would not be valid YAML: ${e}`);
  }

  /**
   * Apply `content` to `path`, gated by the YAML reparse guard. In `reject`
   * mode invalid YAML aborts with INVALID_YAML and no write; in `warn` mode the
   * content is written and tagged with a `warning` (disk-mode option B).
   */
  private commit(path: string, op: Op, content: string, rejectMsg: (yamlErr: string) => string): OpResult {
    const yamlErr = checkYaml(path, content);
    if (yamlErr && this.yamlMode === "reject") {
      return err(path, op, "INVALID_YAML", rejectMsg(yamlErr));
    }
    this.files.set(path, content);
    this.touchedPaths.add(path);
    const result = ok(path, op, "applied", content);
    if (yamlErr) result.warning = `invalid YAML: ${yamlErr}`;
    return result;
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/** Canonical newline form — all bundle content is stored LF; shared with run.ts. */
export function lf(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function ok(path: string, op: Op, status: OpOk["status"], newContent: string): OpOk {
  return { ok: true, path, op, status, newContent };
}

function err(
  path: string,
  op: Op,
  code: ErrCode,
  message: string,
  candidates?: MatchCandidate[],
  count?: number,
): OpErr {
  const e: OpErr = { ok: false, path, op, code, message };
  if (candidates && candidates.length) e.candidates = candidates;
  if (count !== undefined) e.count = count;
  return e;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Non-overlapping start indices of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let pos = 0;
  while (true) {
    const i = haystack.indexOf(needle, pos);
    if (i < 0) break;
    out.push(i);
    pos = i + needle.length;
  }
  return out;
}

/** 1-based line number of the character at `index`. */
function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function lineTextAt(content: string, lineNumber: number): string {
  return content.split("\n")[lineNumber - 1] ?? "";
}

/** The line a match starts on, for NOT_UNIQUE candidate echo. */
function lineCandidate(content: string, startIdx: number): MatchCandidate {
  const line = lineNumberAt(content, startIdx);
  return { line, text: lineTextAt(content, line).trim() };
}

/**
 * Best-effort "did you mean" for NOT_FOUND: file lines that share the first
 * meaningful token of the (failed) anchor's first non-empty line. Cheap, so
 * the model sees the whitespace/escape delta instead of re-copying blind.
 */
function closestLines(content: string, needle: string): MatchCandidate[] {
  const firstLine = needle.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  const probe = firstLine.slice(0, 16);
  if (probe.length < 4) return [];
  const out: MatchCandidate[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && out.length < 2; i++) {
    if (lines[i]!.includes(probe)) out.push({ line: i + 1, text: lines[i]!.trim() });
  }
  return out;
}

/**
 * Parse-only reparse guard. Returns an error string if the post-edit content
 * is not valid YAML (whole doc for *.yaml, fence block only for frontmatter
 * files), or null when there is nothing to check / it parses cleanly. NEVER
 * re-serializes, so it adds safety without serializer drift.
 */
function checkYaml(path: string, content: string): string | null {
  try {
    if (/\.ya?ml$/i.test(path)) {
      parseYaml(content);
      return null;
    }
    const m = FRONTMATTER_RE.exec(content);
    if (m) parseYaml(m[1]!);
    return null;
  } catch (e) {
    return msg(e);
  }
}
