# Skill Standard Structure (issue #259) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the skill contract from `SKILL.md + references/*.md` to the full [Agent Skills standard structure](https://agentskills.io/specification) — `scripts/`, `references/`, `assets/`, **and any additional files or directories** — carried byte-faithfully through loader → reconcile → org-skills repo → design agent → coding runner, with `aep-validation` migrated as the reference example.

**Architecture:** The `Skill` value type keeps its shape — `References map[string]string` becomes the carrier for *every* auxiliary file (path-keyed relative to the skill dir, Go strings are binary-safe); only the scanners change from "references/*.md only" to "walk the whole dir". Model-context read surfaces (design agent `loadSkillReference`) serve UTF-8 text only; binary files are listed but never inlined. `ContentSHA` inputs are unchanged for existing references-only skills (same file set → same hash → no spurious reconcile churn).

**Tech Stack:** Go (`services/aep-api/internal/spec`), TypeScript (`services/agents`, `runners/remote-worker`), git-backed org-skills repos.

## Global Constraints

- Contract (per the standard spec): `SKILL.md` required at the skill root; `scripts/` (executable code), `references/` (docs), `assets/` (templates/resources) are the *named* optional dirs; **arbitrary additional files/dirs are carried faithfully** — no fixed-set parser, no `.md` filter anywhere in the pipeline.
- Skip rules for scanners: skip `SKILL.md` itself (it's the body, not an aux file), skip dotfiles/dot-dirs (`.git`, `.DS_Store`). Everything else is carried.
- Path safety (unchanged, now enforced for all aux paths): reject `..` segments and absolute paths at every write surface.
- Backward compatibility: a references-only skill produces byte-identical org-repo content and an identical `ContentSHA` before/after this change.
- **Commit per task** on `feat/skill-standard-structure` (conventional message, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`). **Never push, never create a PR.**
- TDD per `services/AGENTS.md`: failing test first, then implementation.
- Run task-relevant tests with `go test ./internal/spec/...` (from `services/aep-api`) / `pnpm test` in the touched TS package; full `make test` before handoff.

---

### Task 1: Go — `loadLibrary` walks the whole skill dir

**Files:**
- Modify: `services/aep-api/internal/spec/reconcile.go` (loadLibrary, ~line 267)
- Modify: `services/aep-api/internal/spec/skill.go:39` (comment only — References semantics)
- Test: `services/aep-api/internal/spec/reconcile_more_test.go`

**Interfaces:**
- Produces: `Skill.References` now holds EVERY aux file of the skill dir, keyed by slash-relative path (`"scripts/run.mjs"`, `"assets/t.ts"`, `"references/a.md"`, `"extra/notes.txt"`). Consumed as-is by Tasks 2–5.
- `contentSHA(skillMD, references)` signature unchanged (already sorts keys — deterministic for the larger map).

- [ ] **Step 1: Write the failing test** — extend the test-library FS helper with a standard-structure fixture and assert full carriage:

```go
// TestLoadLibrary_StandardStructure: a skill dir carrying scripts/, assets/,
// references/ (non-.md included), a nested extra dir, and a binary file loads
// with every aux file byte-faithful under its relative path.
func TestLoadLibrary_StandardStructure(t *testing.T) {
	t.Parallel()
	bin := string([]byte{0x00, 0xFF, 0x10, 0x80}) // not valid UTF-8
	fsys := fstest.MapFS{
		"demo/SKILL.md":            {Data: []byte(mkSkillMD("demo", "platform", "demo body"))},
		"demo/references/a.md":     {Data: []byte("ref a")},
		"demo/references/data.json": {Data: []byte(`{"k":1}`)},
		"demo/scripts/run.mjs":     {Data: []byte("console.log(1)\n")},
		"demo/assets/t.template.ts": {Data: []byte("export const T = 1\n")},
		"demo/extra/notes.txt":     {Data: []byte("extra file")},
		"demo/assets/logo.png":     {Data: []byte(bin)},
		"demo/.hidden":             {Data: []byte("skip me")},
	}
	got, err := loadLibrary(fsys)
	if err != nil {
		t.Fatalf("loadLibrary: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 skill, got %d", len(got))
	}
	sk := got[0]
	want := map[string]string{
		"references/a.md":      "ref a",
		"references/data.json": `{"k":1}`,
		"scripts/run.mjs":      "console.log(1)\n",
		"assets/t.template.ts": "export const T = 1\n",
		"extra/notes.txt":      "extra file",
		"assets/logo.png":      bin,
	}
	if len(sk.References) != len(want) {
		t.Fatalf("aux files = %v, want %v", keysOf(sk.References), keysOf(want))
	}
	for p, content := range want {
		if sk.References[p] != content {
			t.Fatalf("%s not byte-faithful", p)
		}
	}
}
```

Also add a SHA-stability guard (protects reconcile from churn):

```go
// TestLoadLibrary_RefsOnlySHAUnchanged: a references-only skill's ContentSHA
// is computed from the same inputs as before the standard-structure change.
func TestLoadLibrary_RefsOnlySHAUnchanged(t *testing.T) {
	t.Parallel()
	md := mkSkillMD("solo", "platform", "solo body")
	fsys := fstest.MapFS{
		"solo/SKILL.md":        {Data: []byte(md)},
		"solo/references/r.md": {Data: []byte("r")},
	}
	got, err := loadLibrary(fsys)
	if err != nil || len(got) != 1 {
		t.Fatalf("loadLibrary: %v (%d skills)", err, len(got))
	}
	if want := contentSHA(md, map[string]string{"references/r.md": "r"}); got[0].ContentSHA != want {
		t.Fatalf("SHA drifted: %s != %s", got[0].ContentSHA, want)
	}
}
```

(Use the existing `mkSkillMD` helper; add tiny `keysOf` only if the file lacks one — `skillKeysOf` exists for Skill maps.)

- [ ] **Step 2: Run to verify failure** — `go test ./internal/spec/ -run TestLoadLibrary_` → FAIL (non-.md and non-references files absent).

- [ ] **Step 3: Implement** — in `loadLibrary`, replace the `refDir` scan block with a walk of the skill dir:

```go
refs := map[string]string{}
skillRoot := path.Join(root, name)
walkErr := fs.WalkDir(fsys, skillRoot, func(p string, d fs.DirEntry, err error) error {
	if err != nil {
		return err
	}
	base := path.Base(p)
	if strings.HasPrefix(base, ".") {
		if d.IsDir() && p != skillRoot {
			return fs.SkipDir
		}
		return nil
	}
	if d.IsDir() {
		return nil
	}
	rel := strings.TrimPrefix(p, skillRoot+"/")
	if rel == skillFileName { // SKILL.md is the body, not an aux file
		return nil
	}
	data, rerr := fs.ReadFile(fsys, p)
	if rerr != nil {
		slog.Warn("skills: embedded aux file read failed", "name", name, "file", rel, "error", rerr)
		return nil
	}
	refs[rel] = string(data)
	return nil
})
if walkErr != nil {
	slog.Warn("skills: embedded skill walk failed", "name", name, "error", walkErr)
}
```

Update the `loadLibrary` doc comment (`references/*.md` → "every aux file, standard structure") and the `Skill.References` field comment in `skill.go` ("all auxiliary files relative to the skill dir — scripts/, references/, assets/, and any extras; values are raw bytes").

- [ ] **Step 4: Run to verify pass** — `go test ./internal/spec/ -run TestLoadLibrary_` → PASS, then the pre-existing `TestLoadEmbeddedLibrary` (still 12 skills; repo-root `skills/` has no non-md aux files today, so counts hold).

- [ ] **Step 5: Commit** (conventional message; no push, no PR).

---

### Task 2: Go — org-repo write/read paths carry the full structure

**Files:**
- Modify: `services/aep-api/internal/spec/repo_store.go` (org-repo catalog read — find the `references/`-scan analog of loadLibrary; `skillRefPath` at :497 is already generic)
- Modify: `services/aep-api/internal/spec/reconcile.go` (`stageWrite` loop already iterates the refs map — verify no `.md` guard)
- Test: `services/aep-api/internal/spec/flat_layout_test.go`

**Interfaces:**
- Consumes: Task 1's all-files `References` map.
- Produces: org-skills repo dirs mirroring the full structure; catalog reads returning the same map, so `ContentSHA` compare (reconcile three-way inputs) sees identical values on both sides.

- [ ] **Step 1: Locate every remaining `.md`/`references/` assumption on the org-repo path.** Run: `grep -rn "references\|\.md" services/aep-api/internal/spec/repo_store.go services/aep-api/internal/spec/skill_service.go` and list each hit as keep/change. Known: the org-repo catalog loader mirrors loadLibrary's old references-only scan — change it identically (walk, skip SKILL.md + dotfiles). `skillRepoPath`/`skillRefPath` need no change.

- [ ] **Step 2: Write the failing round-trip test** (extend `flat_layout_test.go`; the test git host + `Seed`/`FileAt`/`lsTree` helpers exist there):

```go
// TestReconcile_CarriesStandardStructure: an embedded skill with scripts/,
// assets/, and a nested extra file round-trips seed → org repo → catalog read
// with all files intact, and a re-reconcile is a no-op (stable ContentSHA).
func TestReconcile_CarriesStandardStructure(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	c := NewComponentStoreWithLibrary(t, fstest.MapFS{ // add helper if absent:
		// same construction as NewComponentStore but with an injected library FS
		"demo/SKILL.md":         {Data: []byte(mkSkillMD("demo", "platform", "demo"))},
		"demo/scripts/run.mjs":  {Data: []byte("console.log(1)\n")},
		"demo/assets/tpl.ts":    {Data: []byte("export {}\n")},
		"demo/extra/notes.txt":  {Data: []byte("extra")},
	})
	skills, err := c.Svc.List(ctx, "org1") // first read provisions + seeds
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	byName := map[string]Skill{}
	for _, sk := range skills {
		byName[sk.Name] = sk
	}
	demo := byName["demo"]
	for _, p := range []string{"scripts/run.mjs", "assets/tpl.ts", "extra/notes.txt"} {
		if demo.References[p] == "" {
			t.Fatalf("catalog read lost %s: %v", p, skillKeysOf(byName))
		}
	}
	// Files are physically in the org repo.
	if got := c.host.origin("org1").FileAt(t, "main", "skills/demo/scripts/run.mjs"); got != "console.log(1)\n" {
		t.Fatalf("org repo scripts file = %q", got)
	}
	// Re-reconcile: clean copy, no rewrite.
	if n, err := c.Svc.Reconcile(ctx, "org1"); err != nil || n != 0 {
		t.Fatalf("re-reconcile must be a no-op, wrote %d (err %v)", n, err)
	}
}
```

If `NewComponentStore` can't take a custom library FS, add `NewComponentStoreWithLibrary(t, fs.FS)` beside it (same wiring, injected `library`) rather than mutating the shared fixture — existing count-pinned tests (12) must not see the extra skill.

- [ ] **Step 3: Run to verify failure** — `go test ./internal/spec/ -run TestReconcile_CarriesStandardStructure` → FAIL (scripts/assets missing from catalog read or org repo).

- [ ] **Step 4: Implement** — apply the walk to the org-repo catalog loader; confirm `stageWrite`/whole-dir-replace deletes stage the whole `skills/<name>/` prefix (they do — verify with the migration test) so removed scripts don't linger.

- [ ] **Step 5: Run to verify pass** — targeted test, then the full previously-green set: `go test ./internal/spec/` (includes `TestProvision_SeedsFlatLayout`, `TestReconcile_MigratesLegacyRepo` — a custom skill with `scripts/` must also survive migration; extend `TestReconcile_MigratesLegacyRepo`'s seeded custom skill with one `scripts/s.sh` file and assert it survives, mirroring the existing `references/r.md` assertion).

- [ ] **Step 6: Commit** (conventional message; no push, no PR).

---

### Task 3: Go — API surface stays valid JSON with binary aux files

**Files:**
- Inspect first: `services/aep-api/internal/spec/skill_component_test.go` + the skills HTTP handlers (`internal/spec/skills/handler.go`) to see exactly which endpoints inline `references` content.
- Modify: the skill list/get handlers' response mapping.
- Test: `services/aep-api/internal/spec/skill_component_test.go`

**Interfaces:**
- Produces: JSON list/get responses where every aux file appears as a path entry; UTF-8 file content inlines as today; a non-UTF-8 file's content is replaced by `""` with a sibling marker. Console consumes this (no console work in this plan — the console shows/edit skills as text; binary entries render as name-only).

- [ ] **Step 1: Write the failing test** — POST/seed a skill carrying `assets/logo.png` (invalid UTF-8) via the component store, GET it, and assert the response is valid JSON, the png path is listed, its content omitted:

```go
// In the skills component test style: after seeding a library with the binary
// fixture (reuse NewComponentStoreWithLibrary from Task 2):
resp := h.AsOrg("acme").Get(base + "/demo")
if resp.Code != 200 {
	t.Fatalf("get: %d body=%s", resp.Code, resp.Body.String())
}
var sk struct {
	References map[string]string `json:"references"`
	Omitted    []string          `json:"binaryReferences"`
}
if err := json.Unmarshal(resp.Body.Bytes(), &sk); err != nil {
	t.Fatalf("response must stay valid JSON: %v", err)
}
if _, ok := sk.References["assets/logo.png"]; ok {
	t.Fatalf("binary content must not inline")
}
if len(sk.Omitted) != 1 || sk.Omitted[0] != "assets/logo.png" {
	t.Fatalf("binary file must be listed in binaryReferences: %v", sk.Omitted)
}
```

- [ ] **Step 2: Run to verify failure.** Go's `encoding/json` replaces invalid UTF-8 with U+FFFD rather than erroring — the test fails on the "must not inline" assertion (corrupted content WOULD inline). That corruption is the bug being fixed.

- [ ] **Step 3: Implement** — at the response-mapping point (NOT in the domain `Skill` type): split `References` into `references` (only `utf8.ValidString(content)` entries) + `binaryReferences []string` (the rest, sorted). If the API layer uses generated contract types (`packages/contracts/api/`), follow the repo's contract-first rule: add `binaryReferences` to the OpenAPI schema, `make gen-api`, let compile errors drive the handler.

- [ ] **Step 4: Run to verify pass** — component test + `make -C services/aep-api deadcode-check`.

- [ ] **Step 5: Commit** (conventional message; no push, no PR).

---

### Task 4: TS design agent — list and serve the full structure

**Files:**
- Modify: `services/agents/src/conversation/load-workspace.ts:133` (`listReferences`)
- Modify: `services/agents/src/agents/main/tools/skill-tools.ts` (`loadSkillReference` — path schema text + binary guard)
- Test: colocated test file per the package's existing convention (check `services/agents/src/conversation/*.test.ts`)

**Interfaces:**
- Consumes: the `_skills` snapshot dir (unchanged mount).
- Produces: `listReferences(skillDir)` → sorted relative paths of ALL aux files (recursive, any extension, dotfiles skipped); `loadSkillReference` returns file text for UTF-8 files and a corrective error `"<path> is a binary file — it cannot be loaded into context"` for others.

- [ ] **Step 1: Write the failing test** (temp-dir fixture with `scripts/run.mjs`, `references/a.md`, `assets/logo.png` (binary bytes), nested `extra/deep/n.txt`):

```ts
test("listReferences walks the whole skill dir", () => {
  const dir = mkFixtureSkill(); // writes the files above + SKILL.md
  assert.deepEqual(listReferences(dir), [
    "assets/logo.png",
    "extra/deep/n.txt",
    "references/a.md",
    "scripts/run.mjs",
  ]);
});

test("loadSkillReference refuses binary, serves text", async () => {
  // through the SkillSource seam: text file → content; png → corrective error
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test` (agents package) → FAIL (only `references/a.md` listed).

- [ ] **Step 3: Implement** — recursive `readdirSync(..., { recursive: true, withFileTypes: true })` walk from the skill dir, skip `SKILL.md` + dot-entries, keep sort; in the reference tool, read as `Buffer`, `buf.toString("utf8")` and reject when re-encoding mismatches (`Buffer.from(text, "utf8").equals(buf)` is the cheap validity check). Update the tool description string ("a path exactly as listed by loadSkill — docs, scripts, or assets") and the `references/schema.md` example.

- [ ] **Step 4: Run to verify pass** — package tests + `make typecheck`.

- [ ] **Step 5: Commit** (conventional message; no push, no PR).

---

### Task 5: TS coding runner — resolver + materializer carry everything, scripts executable

**Files:**
- Modify: `runners/remote-worker/src/lib/skills_resolver.ts:169` (`readReferences`)
- Modify: `runners/remote-worker/src/lib/skills_materializer.ts:93-101` (write loop)
- Test: the package's existing resolver/materializer tests (extend)

**Interfaces:**
- Consumes: `SkillResolution.references` — widen the type to `Record<string, Buffer>` (resolver + materializer are the only producers/consumers; grep confirms before changing).
- Produces: materialized plugin dir mirroring the full structure; files under `scripts/` written mode `0o755`, everything else `0o644`; any `..`-containing or absolute path skipped (existing guard, now applied to all paths instead of a `references/` prefix filter).

- [ ] **Step 1: Write the failing tests** — resolver: fixture skill dir with the standard structure resolves every file (binary Buffer-faithful); materializer: writes `scripts/run.mjs` with exec bit, skips `../escape` keys, keeps `references/a.md` at `0o644`:

```ts
test("materializeSkills writes the full structure with exec-bit scripts", async () => {
  const out = await materializeSkills(ws, [fixtureResolution()]);
  const skillDir = path.join(out!.pluginDir, "skills", "org-demo");
  assert.ok(fs.existsSync(path.join(skillDir, "assets", "tpl.ts")));
  const mode = fs.statSync(path.join(skillDir, "scripts", "run.mjs")).mode & 0o777;
  assert.equal(mode, 0o755);
});
```

- [ ] **Step 2: Run to verify failure** — non-`references/` files skipped by the `startsWith("references/")` filter.

- [ ] **Step 3: Implement** — resolver: recursive walk reading Buffers; materializer: replace the prefix filter with the path-safety check (`!p.split("/").includes("..") && !path.isAbsolute(p)`), mode by `p.startsWith("scripts/") ? 0o755 : 0o644`.

- [ ] **Step 4: Run to verify pass** — `pnpm test` in `runners/remote-worker` + `make typecheck`.

- [ ] **Step 5: Commit** (conventional message; no push, no PR).

---

### Task 6: Migrate `aep-validation` to the standard layout

**Files:**
- Move: `runners/remote-worker/plugin/skills/aep-validation/references/generate-report.mjs` → `scripts/generate-report.mjs`
- Move: `references/playwright.config.template.ts` + `references/targets.template.ts` → `assets/`
- Keep: `references/authoring.md`, `references/healing.md`
- Modify: `runners/remote-worker/plugin/skills/aep-validation/SKILL.md` (path references at lines 23-24, 128, 130, 132, 209)

**Interfaces:** none new — this is the reference example proving the contract.

- [ ] **Step 1: `git mv` the three files** into `scripts/` and `assets/`.
- [ ] **Step 2: Update every path in SKILL.md** — `grep -n "references/" SKILL.md` must afterwards list ONLY `authoring.md`/`healing.md` mentions; the copy/scaffold instructions point at `assets/…`, the report command at `/app/plugin/skills/aep-validation/scripts/generate-report.mjs`.
- [ ] **Step 3: Sweep for external hardcoded paths** — `grep -rn "aep-validation/references" runners/ services/ Dockerfile* docs/` → update every hit (the baked runner image copies the whole `plugin/` dir, so moves inside it are safe; the concern is absolute paths in prompts/scripts).
- [ ] **Step 4: Verify** — `pnpm test` in `runners/remote-worker`; if the validation runner has an image-level smoke test, run it; otherwise run `node runners/remote-worker/plugin/skills/aep-validation/scripts/generate-report.mjs --help` (or equivalent invocation from the SKILL.md) to prove the moved script still executes.
- [ ] **Step 5: Commit** (conventional message; no push, no PR).

---

### Task 7: Docs — record the extended contract

**Files:**
- Modify: `docs/design/skills-unified-library-migration.md` §3.3 (supersede "SKILL.md (+ references/*.md), no kind directories" with the standard structure + carry-everything rule + UTF-8-text-only read surfaces)
- Modify: the spec-domain README if it states the old contract (`grep -rn "references" services/aep-api/internal/spec/README.md docs/design/*.md` and fix hits)
- Check: `docs/architecture.md` for a skills-layout mention

**Steps:**
- [ ] **Step 1: Update §3.3** to the standard structure (SKILL.md + scripts/references/assets + any extra files; no .md filter; binary carried, listed-not-inlined at model-context and JSON surfaces). Document as current state, not as a change log (per `services/AGENTS.md` docs rules).
- [ ] **Step 2: Sweep remaining docs** with the grep above; fix stale statements in the same task.
- [ ] **Step 3: Full gate** — `make test`, `make lint`, `make typecheck`, `make license-check` (new `scripts/…` files in the plugin keep their existing headers; any NEW source file gets the Apache header).
- [ ] **Step 4: Commit** (conventional message; no push, no PR).

**Cross-branch follow-ups (NOT in this plan — different branches):**
- `feat/skill-authoring`: rewrite the `skill-authoring` SKILL.md "Layout" section to teach the standard structure (its current "everything under references/" claim describes the pre-#259 limitation).
- `feat/skills-experience` spec §2: amend "Skill = guidance text, never code" and the layout row — skills may now ship `scripts/` (executable) and `assets/`.
