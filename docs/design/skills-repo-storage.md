# Skills Repo Storage — git-backed skills, one repo per org

**Status:** Proposal · Author: anjana · Date: 2026-06-21
**Supersedes:** the storage + persistence half of `docs/design/skills-system.md`. The *taxonomy* (builtin/custom/imported), the *two-tier loading* model, the *propagation* across architect → tech-lead → runner, and the SKILL.md frontmatter contract from that doc all stand. What changes is **where the bytes live**: the Postgres `skills` / `skill_audit_events` / `design_version_skill_snapshots` tables are replaced by a per-org GitHub repository as the single source of truth.
**Adjacent design:** `docs/design/artifact-store-v2.md` (the GitHub-API read/write + ETag cache machinery this reuses), `docs/design/repo-storage-ownership.md` + `docs/design/git-integration.md` (per-org repo provisioning + the credential trust model), `docs/design/architect-agent.md`, `docs/design/tech-lead-agent.md`, `docs/design/remote-worker-refactor.md`.
**Platform-touching:** yes — git repos, credentials, provisioning. Design-review gate applies before implementation.

---

## 0. Decisions captured

This doc is the output of a design interview. Every row below was an explicit decision; the rationale lives in the section noted.

| # | Decision | §  |
|---|---|---|
| 1 | **One private `org-skills` repo per org**, owned by the org's GitHub login. "Shared across all projects" = across all projects *in that org*. | §2 |
| 2 | **The repo is the only persistent store.** Drop `skills`, `skill_audit_events`, `design_version_skill_snapshots`. Per-replica in-memory cache only. Git history is the audit trail. | §3 |
| 3 | **BFF stays the credential broker.** Architect & Tech-Lead never get GitHub credentials; only the BFF reads the repo. | §4 |
| 4 | **Keep push.** BFF continues to inline skill bodies into the architect/tech-lead request payloads — only the *origin* of the bytes moves (repo, not Postgres). agents-service gets a thin swappable `resolveSkills()` seam for test injection. | §5 |
| 5 | **Reconciliation is version-based only.** User-modification protection is **deferred** (no lockfile baseline yet). | §6 |
| 6 | **Reconcile triggers:** project-creation (ensure + reconcile) **+** a manual admin "Sync built-in skills" action in org-settings, **+** an "updates available" badge. | §6 |
| 7 | **All readers read HEAD.** No version pinning; mid-flight skill drift is accepted. | §7 |
| 8 | **Reads via GitHub Contents/Tree/Blob API + ETag in-memory cache** (artifact-store-v2 pattern), ~30s soft-TTL for cross-replica coherence. No clones anywhere. | §7 |
| 9 | **Kind-segmented repo layout, no manifest file.** Catalog is derived from the git tree + frontmatter. | §8 |
| 10 | **Writes commit directly to `main`** via GitHub API + the existing leaky-bucket retry. Drop the `IMPORTED_SKILL_IN_USE` delete guard. | §9 |
| 11 | **Provisioning reuses `git_repositories`** with sentinel `project_id="_skills"`; no webhook, no clone. Eager on project-creation + lazy idempotent `ensureSkillsRepo` self-heal on the read path. | §10 |
| 12 | **Clean cutover, no migration.** No custom-skill data exists to preserve (the org-skills feature never shipped). | §11 |
| 13 | **Reads degrade** (stale-while-error → warn-and-continue if cold); **writes hard-fail.** | §12 |

---

## 1. Motivation

Today skills live in Postgres. Built-ins are Go-embedded (`asdlc-service/skills/embed.go` → `//go:embed builtin/*/SKILL.md`) and bootstrapped on BFF startup into a `skills` table (`org_id=''`, `kind='builtin'`). Org skills (custom/imported) would live in the same table, scoped by `org_id`. All three agent surfaces read bodies that originate from that table:

- **Architect** — BFF resolves skills (`design_service.go:resolveArchitectSkills`) and inlines them into the request payload.
- **Tech-Lead** — BFF resolves the project's attached skills (`task_stream.go:resolveProjectSkills`) and inlines them.
- **Remote worker** — pulls `GET /internal/v1/tasks/{taskId}/skills`, which reads a *frozen snapshot* (`design_version_skill_snapshots`), then materializes to `.asdlc/skills-plugin/`.

The problem this redesign solves: **there is no human-facing, git-native source of truth for skills.** A built-in is only editable by changing embedded files and rebuilding the BFF image; an org skill (once the feature ships) would be a Postgres blob with no diffable history, no branch, no PR, no "clone it and read it like the project repo." Skills are domain knowledge — they deserve the same git-backed, reviewable, cloneable home that specs and code already get.

The fix: make each org's skills a **GitHub repo** — the single source of truth that the platform seeds with built-ins, that orgs edit through the console (or directly in git), and that every agent reads from.

## 2. Goals & non-goals

**Goals:**
- One git repo per org as the **single source of truth** for that org's skills (builtin + custom + imported).
- Built-ins ship with the platform (embedded in the BFF container) and are **seeded + version-reconciled** into each org's repo.
- All three agent surfaces (architect, tech-lead, remote worker) read skills **from the repo**.
- Reuse existing machinery: the per-org credential resolver, idempotent repo provisioning, and the artifact-store-v2 GitHub-API read/write + ETag cache.
- Keep the agents-service change minimal (push model preserved) and add a clean **test-injection seam** for skills.

**Non-goals (this version):**
- **User-modification protection** when reconciling built-ins (§6.4) — deferred; the version-based reconcile may overwrite local edits to a built-in.
- **Version pinning / reproducibility** of the skill set per design version (§7.1) — dropped; everyone reads HEAD.
- **Migration tooling** — clean cutover; there is no custom-skill data to preserve (§11).
- Semver/lockfile resolution, skills injecting MCP tools or HTTP calls, skills hot-patching agent code — all still out of scope (unchanged from `skills-system.md`).

## 2.1 Repo scope — one per org

A skills repo is provisioned **per organization**, owned by the org's GitHub login, exactly like project repos. "Shared across all projects" means *across all projects within that org*, not across tenants.

Why per-org and not one global platform repo:
- The platform is multi-tenant. Skills are already `org_id`-scoped; project repos are already created under each org's own GitHub login via a **per-org credential** (App installation or user PAT — `credentials.Resolver.Resolve(ctx, ocOrgID)`).
- A single global repo would require a **platform-level GitHub credential that does not exist today**, and would either leak each org's custom skills to all tenants or force org-namespacing inside one repo. Both break the current isolation model.
- Per-org reuses every existing pattern verbatim: credential resolution, idempotent provisioning, repo ownership.

## 3. Storage model — repo is the only store

The git repo is the **sole persistent store**. The following Postgres tables are **dropped**:

- `skills` — the catalog/body store.
- `skill_audit_events` — the structured mutation log.
- `design_version_skill_snapshots` — the per-design-version frozen bodies.

What replaces each:

| Was (Postgres) | Now (git) |
|---|---|
| `skills.skill_md` / `references` | files in the repo (`SKILL.md` + `references/*.md`) |
| `skills.version` | `metadata.asdlc.version` in SKILL.md frontmatter |
| `skills.content_sha` | git blob/tree SHAs (computed for the in-memory cache, not persisted) |
| `skills.kind` | the path segment (`skills/{builtin,custom,imported}/…`, §8) |
| catalog listing (`ListSummaries`) | walk the git tree + parse frontmatter, cached in-memory (§8) |
| `skill_audit_events` | **git history** — every mutation is a commit (author, timestamp, diff); `git log -- skills/custom/<name>/` reconstructs it |
| `design_version_skill_snapshots` | **nothing** — readers read HEAD (§7) |

**Built-ins stay embedded** in the BFF container (`asdlc-service/skills/embed.go` unchanged). The embed is the *shipping vehicle*; the repo is the *live store*. On reconcile, the embed seeds/updates the repo (§6).

**Caching:** each BFF replica keeps an in-memory cache only (no Postgres, no disk). Coherence across replicas is the artifact-store-v2 soft-TTL + ETag revalidation (§7). The cache is always rebuildable from the repo.

## 4. Who reads the repo — BFF is the broker

Only the **BFF** holds GitHub credentials. Token retrieval is centralized today in one seam:

- `credentials.Resolver.Resolve(ctx, ocOrgID)` (`org_resolver.go`) looks up the `org_credentials` row, rejects empty `ocOrgID`, dispatches on `kind` to a polymorphic `Credential`.
- **User PAT** (`user_pat.go`): reads the PAT from OpenBao at `secret/asdlc/{ocOrgID}/github/pat` per call (singleflight-deduped), never expires.
- **App installation** (`app_token_minter.go`): signs an RS256 App JWT with the App private key, exchanges it for a short-lived installation token, cached ~5 min.

The agents-service (Architect/Tech-Lead) has **no path to GitHub**, and the remote worker never sees a raw token (its workspace is pre-provisioned with git creds + a wrapped `gh`). Making Architect/Tech-Lead read the repo *directly* would mean re-implementing this Resolve→OpenBao→mint stack inside the TS service — a credential-spread with no upside.

**Therefore:** the BFF reads the org's skills repo (§7) and continues to feed the agents exactly as today. The remote worker keeps its existing `GET /tasks/{id}/skills` pull, answered by the BFF reading the repo.

## 5. Keep push — and the agents-service test seam

The BFF→agents-service contract is **unchanged in shape**: the BFF still **inlines skill bodies into the request payloads** (`ArchitectInput.builtinSkills`/`orgSkills`, `TechLeadDetailItem.skillsResolved`, etc.). Only the *origin* of those bytes moves from the `skills` table to the repo. No new agents-service→BFF skill call is introduced.

**Test-injection seam.** Today the routes read skills straight out of the parsed request body, scattered across the prompt builders. Introduce a single, swappable resolver the routes call instead:

```ts
// agents/src/skills/resolve-skills.ts  (new)
// Default impl returns what's in the parsed request body.
// Tests call setSkillsResolver(fake) to inject a canned set, overriding the request.
export interface SkillsResolver {
  forArchitect(input: ArchitectInput): { builtinSkills: SkillRecord[]; orgSkills: SkillDescription[] };
  forTechLeadDetail(item: TechLeadDetailItem): ResolvedSkill[];
  // …
}
let current: SkillsResolver = requestBodyResolver;        // production default
export function resolveSkills(): SkillsResolver { return current; }
export function setSkillsResolver(r: SkillsResolver) { current = r; }   // tests only
```

This mirrors the existing `anthropic-key-resolver.ts` pattern (a module-level swappable singleton). With **push**, there is no live BFF call from the agents-service for a test to replace — the real injection point is the request body, and this seam just makes overriding it uniform and centralized. The remote worker is the surface that genuinely calls the BFF (`skills_pull.ts`), and its tests already have that natural seam.

> Note: the architect's lazy `read_skill(name)` tool (PR-3 front-half in `skills-system.md`) is unaffected and remains future work. Under "keep push," whatever the BFF inlines today, it continues to inline — sourced from the repo. The repo migration is orthogonal to push-payload composition.

## 6. Reconciliation — seeding & updating built-ins

Built-ins flow **embed → repo**. The container ships the canonical latest; the repo holds the live copy.

### 6.1 The two checks

The rule "*check each skill if it's the latest (via version field); if the user modified, don't auto-update*" is two distinct comparisons:

1. **"Is there a newer built-in?"** — compare the embedded copy's `version` (`metadata.asdlc.version`, already parsed) against the repo copy's `version`. Newer embed ⇒ update candidate.
2. **"Did the user modify the repo copy?"** — needs a **baseline** (the `version` field alone can't tell you, since a user can edit the body without bumping `version`). **Deferred — see §6.4.**

### 6.2 Reconcile algorithm (this version — version-based only)

Per built-in skill `s` (under `skills/builtin/<s>/`):

```
repo copy absent                    → seed it (write embed copy, commit)
embed.version > repo.version        → overwrite with embed copy, commit
otherwise                           → leave it
```

No baseline, no "don't clobber" guard. This is a **known, accepted gap**: a version-based overwrite can clobber a user's local edit to a built-in. §6.4 closes it later.

### 6.3 Triggers

- **Project creation** — `ensureSkillsRepo(orgId)` creates the repo if absent (seeding all built-ins) and reconciles if present. This is the repo-bootstrap trigger.
- **Manual "Sync built-in skills"** — an admin-only action in org-settings → skills, running the *same idempotent reconcile routine*. One "sync all" action (not per-skill), with per-skill `version` shown in the list.
- **"Updates available" badge** — the skills section compares the embedded `version` (container) against the repo copy's `version` (in-cache manifest); if any `embed.version > repo.version`, show "N built-in updates available."

> **Why a badge is required, not optional.** With project-creation-only + manual reconcile, an org that already has its repo and never creates a new project (and never clicks reconcile) stays on stale built-ins forever after a deploy. The badge — driven by the version comparison the BFF already computes — is what turns the manual button from a hidden no-op into something discoverable. Without it, the freshness gap never closes in practice.

> **Why not an all-orgs startup sweep / on-demand-at-design-time.** A startup sweep fans out git commits across every org on every boot and needs leader-election across replicas. On-demand-at-design-time writes to the repo on a read path. Both were rejected in favor of explicit, user-controlled reconcile + a discoverability badge.

### 6.4 Deferred — user-modification protection

When built — the planned mechanism is a **platform-written lockfile committed to the repo** (e.g. `.asdlc/skills.lock.json`) mapping each platform-managed skill → `{ version, content_sha }` that the platform last wrote. Reconcile then becomes:

```
sha(repo copy) == lock.sha  &&  embed.version > lock.version   → overwrite, update lock   (auto-update)
sha(repo copy) != lock.sha                                     → user-modified, do NOT touch
```

Chosen over (a) **version-only** (misses content edits that don't bump `version` — the whole point) and (b) **git commit authorship** (unreliable — console edits commit as the bot identity too, so a human edit looks platform-made). Not built in this version.

## 7. Reads — HEAD, GitHub API, ETag cache

### 7.1 Everyone reads HEAD (no pinning)

All three readers read the skills repo at **HEAD** of the default branch. There is **no replacement for the snapshot table** — reproducibility pinning is dropped.

Consequences, accepted:
- A user editing a skill while tasks from one design are mid-flight ⇒ tasks may materialize against different skill bytes depending on timing.
- Re-running task-gen on an old design version uses *current* skills, not the skills the design was authored against.

This is a conscious simplicity trade. (The git-native alternative — pinning a `skillsCommit` SHA into `design.md` frontmatter at design-save and having tech-lead + worker read at that SHA — was considered and rejected for this version.)

### 7.2 Read mechanism

The BFF reads via the **GitHub Contents/Tree/Blob API** (the artifact-store-v2 pattern), **not** a local clone:

- `GetTree(recursive)` to enumerate skill dirs → derive the catalog (§8).
- `GetBlob`/`GetContents` for `SKILL.md` + `references/*.md`.
- All **ETag-conditional**; the in-memory cache is keyed `skill → {version, body, refs, sha, etag}` and revalidated with cheap `304`s.

No local clone anywhere — the BFF is multi-replica and stateless, and a clone would mean N working trees, `pull`-to-track-HEAD, and disk lifecycle for a handful of markdown files.

### 7.3 Cross-replica coherence

Coherence comes free from the artifact-store-v2 cache: a **~30s soft TTL + ETag revalidation**. After a mutation/reconcile, other replicas converge within the TTL. Since readers already accept HEAD-drift (§7.1), ≤30s staleness is within tolerance — no cross-replica invalidation bus is needed. (The mutating replica evicts its own entry immediately, §9.)

### 7.4 Per-surface read path

| Surface | Path |
|---|---|
| **Architect** (interactive design) | BFF reads repo at HEAD (reconciled-latest), inlines bodies into `ArchitectInput` (push). |
| **Tech-Lead** (task-gen) | BFF reads repo at HEAD, inlines into the detail-phase payload (push). |
| **Remote worker** | Keeps `GET /tasks/{id}/skills`; BFF reads repo at HEAD and returns `SkillResolution[]`; worker materializes to `.asdlc/skills-plugin/` unchanged. |

## 8. Repo layout

Kind-segmented directories; **no manifest file**.

```
skills/
  builtin/<name>/SKILL.md      (+ references/*.md)
  custom/<name>/SKILL.md       (+ references/*.md)
  imported/<name>/SKILL.md     (+ references/*.md)
```

- **`kind` is the path segment.** Reconcile walks `skills/builtin/` (no frontmatter parse to classify); the "updates available" badge is a cheap subtree comparison.
- **`version` lives in `SKILL.md` frontmatter** (`metadata.asdlc.version`) — the source of truth for version.
- **No `manifest.json`.** The catalog (name, kind, version, description) is derived by walking the git tree + parsing frontmatter, cached in-memory. A committed manifest would be a second source of truth that drifts from the files — the git tree *is* the manifest.

Names are unique per org across kinds (matching today's `(org_id, name)` PK), so segmenting costs no naming flexibility.

## 9. Writes — direct commit to `main`

Custom create/update/import **and** the built-in reconcile all write to the repo via the GitHub API:

- **Mechanism:** `CreateBlob` / `CreateTree` / `CreateCommit` / `UpdateRef` (same as artifact-store-v2 spec/design saves) — build a tree with the new/updated `SKILL.md` + `references/`, commit, update the ref with the existing **leaky-bucket conflict-retry** for concurrent writers.
- **Target:** **directly to the default branch (`main`)**. The console is the editing surface; skills are configuration, not reviewed code. No PR flow — a save writes straight to `main`, consistent with "read HEAD." A user can also hand-edit in git; both paths commit to `main`. Git history is the audit/review trail.
- **Validation before commit** — reuse the current rules: kebab-case name, required frontmatter (`name`, `description`), `references/*.md` path guard (no traversal), size caps.
- **Committer identity** = the org credential's `Identity()` (bot or PAT owner), same as every other commit.
- **Cache:** on successful commit, the mutating replica **evicts that skill** from its in-memory cache; other replicas converge within the soft TTL (§7.3).

**Dropped guard:** the `IMPORTED_SKILL_IN_USE` (409) delete guard loses its basis — there are no snapshot rows to protect and readers already accept mid-flight drift (§7.1). **Delete = remove the dir + commit;** an in-flight task simply reads HEAD without it.

**Writes hard-fail** (§12) — never leave a half-committed skill.

## 10. Provisioning & lifecycle

The skills repo is **one per org**, and needs *less* than a project repo:

- **No webhook** — no PR/build/issue flow, and cache coherence is TTL-based (§7.3), so nothing subscribes to it.
- **No local clone** — the BFF reads via the GitHub API (§7.2).

### 10.1 Record location

Reuse `git_repositories` with a reserved sentinel `project_id = "_skills"`. Idempotency via `(org_id, "_skills")`, status tracking, and async creation all come from the existing machinery (`repo_service.go`); the webhook + clone steps are simply skipped. (A dedicated `skills_repositories` table was rejected — it re-implements provisioning/status/idempotency that already exists.)

- Repo is **private**, named `org-skills`, owned by the org's GitHub login.
- **Reuse-if-exists:** if an `org-skills` repo already exists for the org, adopt it and reconcile (matches "if it's already there, check each skill").

### 10.2 Provisioning shape

```
ensureSkillsRepo(orgId):
  if no (orgId,"_skills") row or repo absent:
     create private GitHub repo `org-skills` under the org's github_login
     seed all built-ins (one API commit)
     record sentinel row, status=ready
  else:
     reconcile built-ins (§6.2)
```

`create GitHub repo` + `seed built-ins via one API commit` + mark ready — no clone, no webhook.

### 10.3 Readiness — lazy self-heal, not a hard gate

Project-creation kicks off provisioning eagerly (async, as today). But the read path does **not** depend on a separate async readiness signal: the design/task path calls the **idempotent `ensureSkillsRepo(orgId)`** before reading. If the repo is missing it creates+seeds (self-heal) then reads; otherwise it's a cheap cache hit. The first-ever call per org eats a one-time repo-creation latency; every call after is cheap. No readiness race.

## 11. Cutover — no migration

This is a **clean cutover, not a migration**:

- The custom/imported org-skills feature (PR-2 in `skills-system.md`) **never shipped** — the only rows that exist in `skills` are **builtins, re-seedable from the embed**. There is no custom-skill data to preserve.
- **Drop** `skills`, `skill_audit_events`, `design_version_skill_snapshots`.
- Builtins re-seed from the embed into each org's repo via `ensureSkillsRepo`/reconcile.
- No migration tooling, no backfill.

If any environment is later found to hold real custom skills, a one-shot exporter (DB rows → repo commits) would be needed — out of scope here.

## 12. Failure handling

GitHub being unreachable / rate-limited is a new failure mode (skills used to be a local Postgres read).

- **Reads degrade — "stale-while-error."** If the origin is unreachable, keep serving the last-known cached skills *even past the hard TTL*. If the cache is **cold** and skills genuinely can't be loaded, **proceed without skills** and surface a clear warning ("skills temporarily unavailable, proceeding without platform conventions") — do **not** fail the run. This matches the remote worker's existing posture (it already logs *"skill pull/materialize failed — continuing without per-task plugin"* and continues). Interactive design can be re-run.
- **Writes hard-fail** — mutations/reconcile must never half-commit.

The cost is an occasional skills-less run, recoverable by retry — consistent with the overall simplicity bias and the HEAD/no-pin model.

## 13. Implementation surface (orientation, not a task list)

What this redesign touches, by service. Sequencing/PR carve-up is a follow-up.

**BFF (`asdlc-service/`)**
- New: a `SkillsRepoStore` reading/writing the org skills repo via the GitHub API (Tree/Blob/Contents + commit), with the in-memory ETag cache. Sits beside / reuses the artifact-store-v2 client.
- New: `ensureSkillsRepo(orgId)` + reconcile routine (§6.2, §10.2); sentinel `_skills` provisioning via `repo_service.go` (skip webhook/clone).
- Rewire the existing resolvers to read from the repo store instead of Postgres: `design_service.go:resolveArchitectSkills`, `task_stream.go:resolveProjectSkills`, and `task_skills_service.go` (the `GET /tasks/{id}/skills` handler) → read repo at HEAD instead of snapshot rows.
- Mutation endpoints (`skill_routes.go` + `skill_mutation_service.go` / `skill_import_service.go`) → commit to the repo instead of INSERT/UPDATE; drop the in-use delete guard.
- "Updates available" badge data + admin "Sync built-in skills" endpoint.
- **Remove:** the three tables + their migrations + `SkillBootstrap`'s DB upsert (bootstrap now seeds the repo, not Postgres).

**agents-service (`agents/`)**
- Add the `resolveSkills()` seam (§5) + `setSkillsResolver` for tests; route the architect/tech-lead prompt builders through it. No new BFF call (push preserved).

**remote-worker (`remote-worker/`)**
- No change to `skills_pull.ts` / `skills_materializer.ts` / `runner.ts` — the endpoint contract is unchanged; only the BFF's backing store moved.

**console**
- The skills section already exists (`OrgSkillsSettings.tsx` + `orgSkills.ts` client + viewer/editor/import dialogs, route + nav wired). It needs only: the two new client methods (`checkUpdates`, `syncBuiltins`), the "updates available" badge, the per-built-in "update → vN" chip, and the "Sync built-in skills" button. List/create/update/import are unchanged — they hit the same endpoints, now repo-backed.

## 14. Open items / deferred

- **User-modification protection (§6.4)** — lockfile baseline. Deferred; until built, reconcile can clobber local edits to built-ins.
- **Reproducibility pinning (§7.1)** — dropped; revisit if HEAD-drift causes real non-determinism pain.
- **Repo-name collision** with a pre-existing non-platform `org-skills` repo — current stance is reuse-if-exists; revisit if it proves unsafe.
- **Migration exporter (§11)** — only if a real custom-skill dataset surfaces.
