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
 * Workspace-shape input loading (shared-workspace-volume, D4): the ONLY module
 * that reads the shared mount. All three readers take a directory that
 * `snapshot-path.ts` derived and stat-checked — nothing here touches untrusted
 * paths, and nothing here writes.
 *
 *  - `readSnapshot(dir)` walks an immutable per-SHA repo snapshot into the
 *    in-memory `files` map a turn runs against (adapted from the proven
 *    playground `threads.ts` walk — POSIX-relative keys, dot-entries and binary
 *    skipped),
 *    with the aep-api `genai.keepInSnapshot` filter mirrored on top so the turn
 *    input stays a pure function of the sha while derived artifacts stay out.
 *  - `loadSkillsFromSnapshot(dir)` scans the `_skills` snapshot's
 *    `skills/<kind>/<name>/SKILL.md` catalog (frontmatter only — bodies are NOT
 *    retained) and returns a `SkillSource` whose `loadSkill`/
 *    `loadSkillReference` read from disk ON DEMAND: progressive disclosure is
 *    truly lazy, and D4 immutability makes the mid-turn reads race-free. It
 *    also reads the sidecar `<dir>/skills-manifest.json` once (ADR-0014) to
 *    drop any skill an org admin has DISABLED — such a skill never becomes a
 *    row, so it is absent from the catalog and `load`/`loadReference` return
 *    `undefined` for it, same as an unknown name.
 *  - `readReferenceAttachments(dir, references)` reads the `.pdf` entries of a
 *    `start` turn's `TurnSpec.references` as native AI SDK file parts (#384):
 *    `readSnapshot`'s walk SKIPS any file containing a NUL byte, so a binary
 *    PDF never reaches the text `files` map — without this, the model's only
 *    way to see one was pulling it through a tool as "text", which is how a
 *    real turn died (an 868KB PDF read as ~1.5M junk tokens, then the turn
 *    failed at history persistence on the NUL bytes that trip carried). Every
 *    failure mode here is best-effort: a missing/unreadable/oversized file is
 *    warned and skipped, never thrown — same posture as the skill readers
 *    above for ENOENT.
 */

import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { FilePart } from "ai";
import { parse as parseYaml } from "yaml";
// Reuse the bundle's single frontmatter grammar + LF canonicalizer so SKILL.md
// fence parsing cannot drift from the spec-file fence parsing (same approach as
// the caller-side skill resolver the playground uses to materialize the mount).
import { FRONTMATTER_RE, lf } from "@aep/agent-stream";
import type { SkillAudience, SkillLoadResult } from "../agents/main/skill-source.js";
import { ALL_AUDIENCES, SERVICE_AUDIENCE } from "../agents/main/skill-source.js";
import {
  SkillReadError,
  type SkillCatalogEntry,
  type SkillSource,
  type LoadedReference,
} from "../agents/main/skill-source.js";

export { SkillReadError };

/** Skill-read logger: ENOENT is expected (missing/vanished); other I/O is not. */
type SkillReadLog = (msg: string, err: unknown) => void;

const defaultSkillReadLog: SkillReadLog = (msg, err) => {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(`[skills] ${msg}: ${detail}`);
};

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "ENOENT";
}

/** Read text; return undefined on ENOENT. Log and throw SkillReadError on other I/O. */
function readSkillText(abs: string, log: SkillReadLog): string | undefined {
  try {
    return readFileSync(abs, "utf8");
  } catch (err) {
    if (isEnoent(err)) return undefined;
    log(`read failed ${abs}`, err);
    throw new SkillReadError(abs, err);
  }
}

/** Read bytes; return undefined on ENOENT. Log and throw SkillReadError on other I/O. */
function readSkillBytes(abs: string, log: SkillReadLog): Buffer | undefined {
  try {
    return readFileSync(abs);
  } catch (err) {
    if (isEnoent(err)) return undefined;
    log(`read failed ${abs}`, err);
    throw new SkillReadError(abs, err);
  }
}

// --- The repo snapshot → `files` map -----------------------------------------

/**
 * The two OpenAPI contract shapes admitted into a turn snapshot alongside the
 * agent-authored sources below: the produced contract
 * (`specs/design/components/<c>/openapi.yaml`) and a consumed contract
 * (`specs/design/components/<c>/dependencies/<dep>.openapi.yaml`). A
 * resolution/collab turn must be able to read back a spec it (or a prior turn)
 * just stored, so these two are admitted even though snapshots otherwise drop
 * `*.yaml` (e.g. `workload.yaml` stays excluded). `[^/]*` mirrors the Go side's
 * `path.Match` semantics — a `*` matches within one path segment only, never
 * crossing a `/`.
 */
const PRODUCED_SPEC_RE = /^specs\/design\/components\/[^/]*\/openapi\.yaml$/;
const CONSUMED_SPEC_RE = /^specs\/design\/components\/[^/]*\/dependencies\/[^/]*\.openapi\.yaml$/;

function isAdmittedSpecPath(path: string): boolean {
  return PRODUCED_SPEC_RE.test(path) || CONSUMED_SPEC_RE.test(path);
}

/**
 * The turn-snapshot filter — mirrors aep-api `agentfold.KeepInTurnSnapshot`:
 * keep agent-authored sources (`*.md`, `*.dsl`, `*.cell`, component
 * `design.json`, the acceptance oracle `validation-criteria.json`, the two
 * OpenAPI contract shapes above) and drop everything else (derived
 * `.excalidraw`/`*.gen.json` projections, code, arbitrary `*.yaml` such as
 * `workload.yaml`, …). `*.cell` is the project-level cell-diagram DSL
 * (design.cell) that drives the live architecture diagram.
 * validation-criteria.json is kept so a design regeneration can see the
 * existing oracle and preserve its covered flags instead of resetting them.
 */
export function keepInTurnSnapshot(path: string): boolean {
  if (path.endsWith(".md") || path.endsWith(".dsl") || path.endsWith(".cell")) return true;
  if (isAdmittedSpecPath(path)) return true;
  const base = basename(path);
  return base === "design.json" || base === "validation-criteria.json";
}

/**
 * Apply the walk's skip rules to an in-memory map (parity helper for callers
 * that mirror the server's view, e.g. the eval fold): dot-led path segments and
 * filtered-out paths drop; values are assumed text.
 */
export function filterTurnSnapshot(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path.split("/").some((seg) => seg.startsWith("."))) continue;
    if (!keepInTurnSnapshot(path)) continue;
    out[path] = content;
  }
  return out;
}

function walk(dir: string, rel: string, out: Record<string, string>): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue; // dot-entries (.git, .DS_Store, …)
    const abs = join(dir, e.name);
    const key = rel ? `${rel}/${e.name}` : e.name; // POSIX-relative key
    if (e.isDirectory()) {
      walk(abs, key, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (!keepInTurnSnapshot(key)) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // a NUL byte → binary; the agent only edits text
    out[key] = buf.toString("utf8");
  }
}

/**
 * Read one immutable per-SHA snapshot dir into the in-memory `files` map a turn
 * runs against (feeding `new FileBundle(map)` / `new TaskPlan(map)` and
 * `buildPrompt` byte-unchanged). Adapted from `playground/threads.ts`
 * `readSnapshot` (copied — `src/` must not import the playground tree).
 */
export function readSnapshot(snapshotDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  walk(snapshotDir, "", out);
  return out;
}

// --- Reference PDFs → native AI SDK file parts (#384) -------------------------

/** Anthropic's request size limit is ~32MB; this leaves headroom for everything else on the wire. */
export const MAX_REFERENCE_ATTACHMENT_BYTES = 30 * 1024 * 1024;

/**
 * The binary reference types the model reads natively, by extension: PDFs as
 * document blocks, images as image blocks. Anything else binary has no native
 * representation and is skipped (it is also invisible to the text snapshot,
 * which is exactly why these ride as parts at all).
 */
const NATIVE_MEDIA_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function nativeMediaTypeFor(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return NATIVE_MEDIA_BY_EXT[ext];
}

/**
 * Read one reference's PDF bytes as a `FilePart`, or `undefined` on any
 * best-effort skip (never throws): outside the snapshot dir (a hostile or
 * malformed path — resolved and prefix-checked rather than string-matched, so
 * no `..` trick or symlink-adjacent spelling slips through), missing, unreadable,
 * or over `MAX_REFERENCE_ATTACHMENT_BYTES`. `data` is base64 — the AI SDK
 * accepts a bare base64 string as `DataContent`, and it keeps the eventual
 * conversation-history JSON compact (a `Buffer` would serialize as a giant
 * `{type:"Buffer",data:[...]}` byte array instead).
 */
function readOneReferenceAttachment(snapshotDir: string, refPath: string, snapshotRoot: string, mediaType: string): FilePart | undefined {
  const abs = resolve(snapshotDir, refPath);
  if (abs !== snapshotRoot && !abs.startsWith(snapshotRoot + sep)) {
    console.warn(`[references] skipping reference outside the snapshot: ${refPath}`);
    return undefined;
  }
  let size: number;
  try {
    size = statSync(abs).size;
  } catch (err) {
    console.warn(`[references] skipping unreadable reference ${refPath}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  if (size > MAX_REFERENCE_ATTACHMENT_BYTES) {
    console.warn(`[references] skipping oversized reference ${refPath}: ${size} bytes > ${MAX_REFERENCE_ATTACHMENT_BYTES} cap`);
    return undefined;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    console.warn(`[references] failed to read reference ${refPath}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  return { type: "file", data: bytes.toString("base64"), mediaType, filename: refPath };
}

/**
 * Attach every natively-readable binary reference (case-insensitive `.pdf`,
 * `.png`, `.jpg`/`.jpeg`) in a `start` turn's `TurnSpec.references` as a
 * native AI SDK file part — Anthropic reads PDFs as document blocks and
 * images as image blocks, so the model sees the actual mockup or form rather
 * than pulling bytes through a tool as "text" (see the module doc for why
 * that mattered). Text references (`.md`/`.txt`) are already inlined by
 * `readSnapshot` and are left alone here. Absent/empty `references` → `[]`,
 * so a turn with no attachable references builds byte-identical messages to
 * before this existed.
 */
export function readReferenceAttachments(snapshotDir: string, references: string[] | undefined): FilePart[] {
  const snapshotRoot = resolve(snapshotDir);
  const parts: FilePart[] = [];
  for (const raw of references ?? []) {
    const refPath = raw.trim();
    if (refPath === "") continue;
    const mediaType = nativeMediaTypeFor(refPath);
    if (!mediaType) continue;
    const part = readOneReferenceAttachment(snapshotDir, refPath, snapshotRoot, mediaType);
    if (part) parts.push(part);
  }
  return parts;
}

/** Where the console commits uploaded reference documents (#383/#384). */
export const REFERENCES_PREFIX = "specs/requirements/references/";

/**
 * Overlay the GIT snapshot's reference-document texts onto a room-scoped
 * turn's files. The collab room deliberately excludes reference documents
 * (they are inputs, not collaboratively-edited spec), so a turn whose CURRENT
 * STATE comes from the room would silently lose the user's text references —
 * a live /start did exactly that: the steer listed claim.md, the snapshot
 * held it, and the prompt never saw it. Git is the authority for references,
 * so a stale room copy (seeded before the exclusion existed) is overwritten,
 * and the room stays the authority for everything else.
 */
export function overlayReferenceTexts(
  roomFiles: Record<string, string>,
  gitFiles: Record<string, string>,
): Record<string, string> {
  const refs = Object.entries(gitFiles).filter(([path]) => path.startsWith(REFERENCES_PREFIX));
  if (refs.length === 0) return roomFiles;
  const out = { ...roomFiles };
  for (const [path, content] of refs) out[path] = content;
  return out;
}

// --- The `_skills` snapshot → lazy SkillSource --------------------------------

/** Split a `SKILL.md` into frontmatter fields + body (mirrors the caller-side skill resolver). */
function parseSkillMd(raw: string): {
  name?: string;
  description: string;
  body: string;
  audience: readonly SkillAudience[];
} {
  const text = lf(raw);
  const m = FRONTMATTER_RE.exec(text);
  const frontmatter = m?.[1] ?? "";
  const body = m ? text.slice(m[0].length) : text;
  let fm: Record<string, unknown> = {};
  if (frontmatter.trim() !== "") {
    try {
      const parsed = parseYaml(frontmatter) as unknown;
      if (parsed && typeof parsed === "object") fm = parsed as Record<string, unknown>;
    } catch {
      // Unparseable frontmatter → treat as absent; the dir name still names the skill.
    }
  }
  // `metadata.aep.audience` — which agents may load this skill (ADR-0013).
  // Unrecognised values are dropped rather than becoming a third audience; a
  // skill left with nothing declared resolves to EVERY audience, so an unmarked
  // (or misspelt) skill stays loadable instead of silently disappearing.
  const aep = (fm.metadata as Record<string, unknown> | undefined)?.aep as Record<string, unknown> | undefined;
  const declared = Array.isArray(aep?.audience) ? aep.audience : [];
  const audience = declared.filter((a): a is SkillAudience => a === "design" || a === "coding");
  return {
    ...(typeof fm.name === "string" && fm.name.trim() !== "" ? { name: fm.name } : {}),
    description: typeof fm.description === "string" ? fm.description : "",
    body,
    audience: audience.length > 0 ? audience : ALL_AUDIENCES,
  };
}

/**
 * Sorted relative paths of every aux file under one skill dir (readdir at call
 * time — D4-immutable): the Agent Skills standard structure carries SKILL.md
 * plus ANY supporting files — `references/*.md`, `scripts/*`, `assets/*`, or
 * arbitrary extras nested arbitrarily deep. Recurses the whole skill dir,
 * skipping the top-level SKILL.md and dot-entries (files and dirs, at any
 * depth) — the same skip rule the Go-side scan applies.
 */
function listReferences(skillDir: string, log: SkillReadLog = defaultSkillReadLog): string[] {
  const out: string[] = [];
  const walkAux = (dir: string, rel: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return;
      log(`readdir failed ${dir}`, err);
      throw new SkillReadError(dir, err);
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // dot-entries (files and dirs) skipped
      if (rel === "" && e.name === "SKILL.md") continue; // the skill body itself, not an aux file
      const abs = join(dir, e.name);
      const key = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walkAux(abs, key);
        continue;
      }
      if (!e.isFile()) continue;
      out.push(key);
    }
  };
  walkAux(skillDir, "");
  return out.sort();
}

interface CatalogRow extends SkillCatalogEntry {
  /** Absolute skill dir — the lazy loaders read SKILL.md/references from here. */
  dir: string;
}

/**
 * The disk-backed `SkillSource` over one immutable `_skills` snapshot. The
 * constructor scans ONLY the catalog surface (frontmatter name/description +
 * whether references exist); bodies are read from disk when `loadSkill` /
 * `loadSkillReference` actually run.
 */
export class SnapshotSkillSource implements SkillSource {
  private readonly rows: CatalogRow[];
  private readonly byName: Map<string, CatalogRow>;
  private readonly log: SkillReadLog;

  constructor(skillsSnapshotDir: string, log: SkillReadLog = defaultSkillReadLog) {
    this.log = log;
    this.rows = scanCatalog(skillsSnapshotDir, log);
    this.byName = new Map(this.rows.map((r) => [r.name, r] as const));
  }

  catalog(): readonly SkillCatalogEntry[] {
    return this.rows.map(({ name, description, hasReferences, audience }) => ({
      name,
      description,
      hasReferences,
      audience,
    }));
  }

  load(name: string): SkillLoadResult {
    const row = this.byName.get(name);
    if (row === undefined) return undefined;
    // Audience gate before any disk read: this consumer may see the row (it
    // needs the name to pin the skill onto a component) but not the body.
    if (!row.audience.includes(SERVICE_AUDIENCE)) return { refused: true };
    const abs = join(row.dir, "SKILL.md");
    const raw = readSkillText(abs, this.log);
    if (raw === undefined) return undefined;
    return { content: parseSkillMd(raw).body.trim(), references: listReferences(row.dir, this.log) };
  }

  loadReference(name: string, path: string): LoadedReference {
    const row = this.byName.get(name);
    if (row === undefined) return undefined;
    // Fence-by-allowlist: the model-supplied path must be one of the LISTED
    // reference paths (never resolved raw against the fs).
    if (!listReferences(row.dir, this.log).includes(path)) return undefined;
    const abs = join(row.dir, path);
    const buf = readSkillBytes(abs, this.log);
    if (buf === undefined) return undefined;
    // Cheap UTF-8 validity check: re-encode the decoded text and compare bytes
    // — a mismatch means the file isn't valid UTF-8 text (binary), and
    // model-context surfaces must never inline binary.
    const text = buf.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buf)) return { binary: true };
    return { content: text };
  }
}

/**
 * The RETIRED kind path-segments of the pre-flat org-skills layout
 * (`skills/<kindDir>/<name>/`). Old per-SHA snapshots keep this shape forever,
 * so the scan tolerates it alongside the current flat layout.
 */
const LEGACY_KIND_DIRS = new Set(["builtin", "flow", "custom", "imported"]);

/**
 * Read the sidecar `skills-manifest.json` (ADR-0014) and return the set of
 * skill names an org admin has DISABLED. Availability FAILS OPEN: a missing
 * file, unreadable file, invalid JSON, a non-object root, or an entry that
 * isn't itself an object all yield an EMPTY set (nothing disabled) rather
 * than throwing — a malformed sidecar must never blank an org's whole
 * catalog, which would be far worse than serving a skill that should have
 * been hidden. Each entry is checked individually so one bad entry cannot
 * poison the read of the rest.
 */
function readDisabledSkillNames(snapshotDir: string): Set<string> {
  const disabled = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(join(snapshotDir, "skills-manifest.json"), "utf8");
  } catch {
    return disabled; // no manifest → nothing disabled
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return disabled; // unparseable → nothing disabled
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return disabled;
  for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (entry !== null && typeof entry === "object" && (entry as Record<string, unknown>).disabled === true) {
      disabled.add(name);
    }
  }
  return disabled;
}

/**
 * Scan the snapshot's skill catalog into rows. The current shape is FLAT —
 * `<snapshotDir>/skills/<name>/SKILL.md` with the kind in frontmatter
 * (`metadata.aep.kind`; irrelevant to this scan) — and the legacy nested shape
 * `skills/<kindDir>/<name>/SKILL.md` is tolerated for old snapshots.
 * Deterministic order: flat dirs sorted first, then legacy kind dirs sorted
 * with skill dirs sorted within each; a duplicate skill NAME keeps its first
 * occurrence (so a flat copy wins over a legacy one). A dir whose SKILL.md is
 * missing (ENOENT) is simply not a skill; a SKILL.md that exists but cannot be
 * read (non-ENOENT I/O) fails the catalog load via `SkillReadError`. A snapshot
 * without `skills/` yields an empty catalog. A skill named in the
 * `skills-manifest.json` sidecar with `disabled: true` (ADR-0014) never becomes
 * a row at all — it is withheld from this org entirely, not merely
 * access-gated — so it never reaches `this.rows`/`this.byName` and
 * `load`/`loadReference` fall through to their "unknown name" branch for free.
 */
function scanCatalog(snapshotDir: string, log: SkillReadLog = defaultSkillReadLog): CatalogRow[] {
  const skillsRoot = join(snapshotDir, "skills");
  if (!existsSync(skillsRoot)) return [];
  const disabledNames = readDisabledSkillNames(snapshotDir);
  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  const addSkillDir = (dir: string, id: string): void => {
    const skillMd = join(dir, "SKILL.md");
    const raw = readSkillText(skillMd, log);
    if (raw === undefined) return; // ENOENT — not a skill
    const parsed = parseSkillMd(raw);
    const name = parsed.name ?? id; // fallback: the dir name IS the skill id
    if (seen.has(name)) return;
    seen.add(name);
    if (disabledNames.has(name)) return; // disabled → does not exist for this org
    rows.push({
      name,
      description: parsed.description,
      hasReferences: listReferences(dir, log).length > 0,
      audience: parsed.audience,
      dir,
    });
  };

  // Flat layout first (a dir holding SKILL.md directly IS a skill — even one
  // named like a kind word; those names are reserved server-side).
  const legacyKindDirs: string[] = [];
  for (const entry of listDirs(skillsRoot)) {
    const dir = join(skillsRoot, entry);
    if (existsSync(join(dir, "SKILL.md"))) {
      addSkillDir(dir, entry);
    } else if (LEGACY_KIND_DIRS.has(entry)) {
      legacyKindDirs.push(entry);
    }
  }
  for (const kind of legacyKindDirs) {
    for (const id of listDirs(join(skillsRoot, kind))) {
      addSkillDir(join(skillsRoot, kind, id), id);
    }
  }
  return rows;
}

function listDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Build the lazy, disk-backed skill source over one `_skills` snapshot dir. */
export function loadSkillsFromSnapshot(skillsSnapshotDir: string): SnapshotSkillSource {
  return new SnapshotSkillSource(skillsSnapshotDir);
}
