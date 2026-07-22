// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package spec

// Provisioning + platform-skill reconciliation. The platform skill library
// ships in the BFF container as on-disk files (config.SkillsDir, read at
// runtime; platform + org kinds, kind in frontmatter) and is seeded +
// reconciled into each org's skills repo (the live store) under the FLAT
// layout skills/<name>/. Reconcile is a THREE-WAY compare per skill against
// skills-manifest.json (§3), the org's baseline of what a platform-managed
// skill was last handed at: did the org's copy move off the baseline, and did
// the platform's move off the baseline? absent repo copy → seed; org clean +
// platform moved → refresh (and advance the baseline); org moved + platform
// clean → leave the override alone (never touched); both moved → leave it
// alone as a conflict, surfaced by /updates, UNLESS the two copies converged
// on identical content, which auto-resolves clean; a pre-manifest repo copy
// is backfilled (baseline stamped so future compares work, a divergent copy
// treated as an override and never clobbered). The manifest is rewritten in
// the SAME commit as any file changes it reflects. A name owned by a user
// kind (custom/imported) never carries a platform manifest entry, so it is
// skipped outright — the user copy always wins. Names the manifest still
// tracks as platform-shipped that the embed no longer ships are purged: a
// clean copy's files are deleted; an overridden copy's files are kept and
// just the entry dropped (divergence is ownership — it becomes a plain org
// skill). A name with no manifest entry at all is org-authored and reconcile
// never touches it. Reconcile also MIGRATES legacy-layout repos
// (skills/<kindDir>/<name>/) in the same single commit: user skills move to
// their flat dir with the kind stamped into frontmatter, embedded skills are
// rewritten flat (a divergent legacy copy is treated as a pre-manifest
// override, per the backfill rule above), and the retired kind dirs are
// removed (§4).

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"path"
	"strings"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// SkillUpdate is one row of the "updates available" view: a platform-shipped
// skill whose state differs from the org's baseline. State semantics: "update"
// = clean copy, platform moved (sync refreshes it); "overridden" = org moved
// (sync never touches it); "conflict" = both moved (review required). §6.3 +
// skills-experience spec §3.
type SkillUpdate struct {
	Name  string `json:"name"`
	State string `json:"state"`
}

// ensureSkillsRepo idempotently provisions the org's skills repo, seeding
// built-ins + flow skills on first creation (lazy self-heal on the read path).
// §10.3.
//
// The per-org lock is held across the WHOLE function — deliberately, not just
// the provision branch. EnsureBareRepo creates the repo ROW before the seed
// commit lands, so a concurrent reader that slipped past the lock could see
// the row and read a still-empty repo (empty skills on first load). The gitfs
// flock + push-CAS don't close that window (they arbitrate writes, not
// first-load ordering), and the GitHub repo creation itself runs under no
// flock at all — this narrow in-process guard covers exactly that first-time
// step. In steady state it wraps only a ~1ms GetRepo at design/task QPS.
func (s *SkillService) ensureSkillsRepo(ctx context.Context, orgID string) (*sourcecontrol.GitRepository, error) {
	mu := s.orgLock(orgID)
	mu.Lock()
	defer mu.Unlock()

	repo, err := s.repos.GetRepo(ctx, orgID, SkillsRepoProject)
	if err == nil {
		return repo, nil
	}
	if !errors.Is(err, sourcecontrol.ErrRepoNotFound) {
		return nil, err
	}
	// First time for this org — create the bare repo and seed the embedded skills.
	repo, err = s.repos.EnsureBareRepo(ctx, orgID, SkillsRepoProject, SkillsRepoName)
	if err != nil {
		return nil, err
	}
	if n, serr := s.reconcileEmbedded(ctx, orgID, repo); serr != nil {
		slog.WarnContext(ctx, "skills: seed embedded skills failed (repo provisioned)", "org", orgID, "error", serr)
	} else {
		slog.InfoContext(ctx, "skills: seeded embedded skills into new repo", "org", orgID, "count", n)
	}
	return repo, nil
}

// EnsureProvisioned ensures the org's skills repo exists (+ seeds the embedded
// skills on first creation). Called eagerly on project creation. §6.3/§10.2.
func (s *SkillService) EnsureProvisioned(ctx context.Context, orgID string) error {
	if s == nil || s.repos == nil || orgID == "" {
		return nil
	}
	_, err := s.ensureSkillsRepo(ctx, orgID)
	return err
}

// Reconcile drives the three-way reconcile of the embedded library for an org
// (seed/refresh/backfill/override/conflict/purge + legacy-layout migration).
// Used by project creation and the admin "Sync built-in skills" action. §6.
func (s *SkillService) Reconcile(ctx context.Context, orgID string) (int, error) {
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		return 0, err
	}
	return s.reconcileEmbedded(ctx, orgID, repo)
}

// isUserKind reports whether a kind is user-owned (never touched by reconcile).
func isUserKind(kind string) bool {
	return kind == SkillKindCustom || kind == SkillKindImported
}

// reconcileEmbedded drives the whole repo to the desired flat state in ONE
// commit, deciding each embedded skill's fate with the three-way compare
// (decideReconcile, §3) against its skills-manifest.json baseline:
//
//   - every embedded skill absent from the repo, or clean with the platform
//     moved, is (re)written flat and its baseline advanced — unless a user
//     kind owns the name (the user copy wins, the embedded skill is
//     skipped);
//   - a repo copy the org diverged (with the platform not moving, or a
//     conflict where both moved) is left alone — reconcile never clobbers an
//     org edit;
//   - a pre-manifest repo copy (no entry yet — first reconcile after this
//     migration, or a legacy-dir copy) is backfilled: the baseline is stamped
//     so future reconciles compare correctly, but a divergent copy's content
//     is never rewritten;
//   - user skills found in legacy dirs are moved to their flat dir with the
//     kind stamped into frontmatter (§4);
//   - names the manifest still tracks as platform-shipped that the embed no
//     longer ships are purged: a clean copy's files are deleted (without this
//     a retired skill would linger in every org repo forever and keep
//     getting inlined into agent prompts); an overridden copy's files are
//     kept and its entry dropped (the org now owns the name outright);
//   - the retired legacy kind dirs are removed wholesale (writes land at flat
//     paths, so the staged prefix deletes only ever remove old copies).
//
// The manifest is rewritten in the same commit as any file changes it
// reflects. A rewritten skill's flat directory is replaced wholesale (delete
// staged before the writes) so references removed by the new content never
// linger. Returns the number of skills written + migrated + purged (the
// manifest-only stamp of a backfill is not counted, but still committed).
// §6.2.
func (s *SkillService) reconcileEmbedded(ctx context.Context, orgID string, repo *sourcecontrol.GitRepository) (int, error) {
	embedded, err := loadLibrary(s.library)
	if err != nil {
		return 0, err
	}
	entries, manifest, err := s.loadEntriesAndManifest(ctx, orgID, repo)
	if err != nil {
		return 0, err
	}
	current := map[string]catalogEntry{}
	hasLegacy := false
	for _, e := range entries {
		current[e.Name] = e
		if e.legacyDir != "" {
			hasLegacy = true
		}
	}

	embeddedNames := make(map[string]bool, len(embedded))
	writes := map[string][]byte{}
	var deletes []string
	written, migrated, purged := 0, 0, 0
	manifestDirty := false
	// manifestSet/manifestDelete are the manifest DELTA reconcile computes
	// against the pre-read `manifest`. They are re-applied INSIDE the commit
	// closure (commitFiles' manifestFn) against the attempt's live base, so a
	// concurrent import/delete that advanced the manifest is merged in rather
	// than clobbered on a CAS retry. The `manifest` map itself is still mutated
	// in place below purely to keep the pre-read decision logic
	// (entry lookups, dirty accounting) unchanged.
	manifestSet := map[string]ManifestEntry{}
	manifestDelete := map[string]bool{}

	stageWrite := func(name, skillMD string, refs map[string]string) {
		writes[skillRepoPath(name)] = []byte(skillMD)
		for refKey, content := range refs {
			writes[skillRefPath(name, refKey)] = []byte(content)
		}
	}
	setBase := func(name, sha string) {
		want := ManifestEntry{Kind: ManifestKindPlatform, BaseHash: sha}
		if manifest[name] != want {
			manifest[name] = want
			manifestDirty = true
		}
		manifestSet[name] = want // record the delta op (idempotent per attempt)
	}

	for _, b := range embedded {
		embeddedNames[b.Name] = true
		cur, ok := current[b.Name]
		if ok && isUserKind(cur.Kind) {
			continue // a custom/imported copy owns this name — never touch it
		}
		var entry *ManifestEntry
		if e, has := manifest[b.Name]; has {
			entry = &e
		}
		// Legacy-dir copies predate the manifest: treat as pre-manifest (nil
		// entry) so backfill semantics apply; the rewrite below re-flattens.
		if ok && cur.legacyDir != "" && entry == nil {
			if cur.ContentSHA == b.ContentSHA {
				written++ // legacy but clean: rewrite flat at embed content
				deletes = append(deletes, skillRepoDir(b.Name))
				stageWrite(b.Name, b.SkillMD, b.References)
				setBase(b.Name, b.ContentSHA)
			} else {
				// Divergent legacy copy of an embedded name: keep content,
				// move flat via the user-skill migration path below is NOT
				// available (kind is platform/org) — rewrite flat preserving
				// the org's content, stamp as override.
				written++
				deletes = append(deletes, skillRepoDir(b.Name))
				stageWrite(b.Name, cur.SkillMD, cur.References)
				setBase(b.Name, b.ContentSHA)
			}
			continue
		}
		switch decideReconcile(b.ContentSHA, cur.ContentSHA, ok, entry) {
		case actionSeed, actionRefresh:
			written++
			deletes = append(deletes, skillRepoDir(b.Name))
			stageWrite(b.Name, b.SkillMD, b.References)
			setBase(b.Name, b.ContentSHA)
		case actionBackfill, actionBackfillOverride:
			setBase(b.Name, b.ContentSHA) // stamp only — no file writes
		case actionOverride, actionConflict:
			// Org-owned divergence: never write files, never move the base.
			// (These actions only arise with an existing entry — the nil-entry
			// divergent case is actionBackfillOverride above.)
		case actionSkip:
		}
	}

	// Legacy migration of user-kind skills: unchanged from today.
	for name, cur := range current {
		if isUserKind(cur.Kind) && cur.legacyDir != "" {
			migrated++
			stamped, serr := stampFrontmatterKind(cur.SkillMD, cur.Kind)
			if serr != nil {
				slog.WarnContext(ctx, "skills: migrate stamp failed — moving unstamped", "org", orgID, "name", name, "error", serr)
				stamped = cur.SkillMD
			}
			stageWrite(name, stamped, cur.References)
		}
	}

	// Purge: ONLY names the manifest says are platform-shipped and the embed
	// no longer ships. Clean copy → delete; overridden copy → keep the files,
	// drop the entry (divergence = ownership, it becomes a plain org skill).
	// Names with no manifest entry are org-authored and never touched.
	for name, entry := range manifest {
		if entry.Kind != ManifestKindPlatform || embeddedNames[name] {
			continue
		}
		purged++
		manifestDirty = true
		delete(manifest, name)
		manifestDelete[name] = true // record the delta op
		if cur, ok := current[name]; ok && cur.ContentSHA == entry.BaseHash {
			if cur.legacyDir == "" {
				deletes = append(deletes, skillRepoDir(name))
			} // legacy copies fall to the wholesale prefix deletes below
		}
	}

	if hasLegacy {
		for dir := range legacyKindDirs {
			deletes = append(deletes, skillsRootDir+"/"+dir)
		}
	}

	changed := written + migrated + purged
	if changed == 0 && !manifestDirty {
		return 0, nil
	}
	// The manifest is merged in the SAME commit as the file changes, but via
	// the closure-scoped delta (commitFiles' manifestFn) so a concurrent
	// writer's entries survive a CAS retry. Only the manifest is retry-safe;
	// the file writes/deletes above were planned against the pre-read state
	// (see commitFiles' scope-boundary note).
	manifestFn := func(m SkillsManifest) SkillsManifest {
		for name, entry := range manifestSet {
			m[name] = entry
		}
		for name := range manifestDelete {
			delete(m, name)
		}
		return m
	}
	msg := fmt.Sprintf("chore(skills): reconcile embedded library (%d written, %d migrated, %d retired)", written, migrated, purged)
	if _, err := s.commitFiles(ctx, orgID, repo, msg, writes, deletes, manifestFn); err != nil {
		return 0, err
	}
	slog.InfoContext(ctx, "skills: reconciled embedded skills", "org", orgID, "written", written, "migrated", migrated, "purged", purged)
	return changed, nil
}

// UpdatesAvailable evaluates the same three-way compare as reconcile,
// read-only. Names owned by a user kind or with an imported manifest entry
// are skipped; a pre-manifest divergent copy reports "overridden" (the
// migration posture: never suggest a clobber).
func (s *SkillService) UpdatesAvailable(ctx context.Context, orgID string) ([]SkillUpdate, error) {
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		return nil, err
	}
	embedded, err := loadLibrary(s.library)
	if err != nil {
		return nil, err
	}
	entries, manifest, err := s.loadEntriesAndManifest(ctx, orgID, repo)
	if err != nil {
		return nil, err
	}
	current := map[string]catalogEntry{}
	for _, e := range entries {
		current[e.Name] = e
	}
	var out []SkillUpdate
	for _, b := range embedded {
		cur, ok := current[b.Name]
		if ok && isUserKind(cur.Kind) {
			continue
		}
		var entry *ManifestEntry
		if e, has := manifest[b.Name]; has {
			entry = &e
		}
		switch decideReconcile(b.ContentSHA, cur.ContentSHA, ok, entry) {
		case actionSeed, actionRefresh:
			out = append(out, SkillUpdate{Name: b.Name, State: "update"})
		case actionOverride, actionBackfillOverride:
			out = append(out, SkillUpdate{Name: b.Name, State: "overridden"})
		case actionConflict:
			out = append(out, SkillUpdate{Name: b.Name, State: "conflict"})
		}
	}
	return out, nil
}

// loadLibrary reads the whole platform skill library (fsys rooted at the
// library dir, i.e. <name>/SKILL.md + optional references/*.md) into the
// canonical Skill shape. In production fsys is os.DirFS(config.SkillsDir); in
// tests it is an injected fs.FS. Each skill's kind comes from its frontmatter
// (`metadata.aep.kind`; absent → org); the library may only carry the
// platform-shipped kinds — anything else is coerced to org with a warning.
// Entries without a parseable SKILL.md whose frontmatter name matches the
// directory are skipped with a warning — a bad bundled file must never break
// provisioning. A nil fsys yields an empty library (seed nothing).
func loadLibrary(fsys fs.FS) ([]Skill, error) {
	if fsys == nil {
		return nil, nil
	}
	const root = "."
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return nil, fmt.Errorf("read skills library dir: %w", err)
	}
	out := make([]Skill, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		raw, err := fs.ReadFile(fsys, path.Join(root, name, skillFileName))
		if err != nil {
			slog.Warn("skills: embedded skill read failed", "name", name, "error", err)
			continue
		}
		fm, _, err := parseSkillMD(string(raw))
		if err != nil {
			slog.Warn("skills: embedded skill parse failed", "name", name, "error", err)
			continue
		}
		if fm.Name != name {
			slog.Warn("skills: embedded skill name mismatch", "dir", name, "frontmatter", fm.Name)
			continue
		}
		kind := frontmatterKind(fm)
		if kind != SkillKindPlatform && kind != SkillKindOrg {
			slog.Warn("skills: embedded skill carries a user kind — coerced to org", "name", name, "kind", kind)
			kind = SkillKindOrg
		}
		refs := map[string]string{}
		refDir := path.Join(root, name, "references")
		if refEntries, err := fs.ReadDir(fsys, refDir); err == nil {
			for _, r := range refEntries {
				if r.IsDir() || !strings.HasSuffix(r.Name(), ".md") {
					continue
				}
				data, err := fs.ReadFile(fsys, path.Join(refDir, r.Name()))
				if err != nil {
					slog.Warn("skills: embedded reference read failed", "name", name, "ref", r.Name(), "error", err)
					continue
				}
				refs[refsPrefix+r.Name()] = string(data)
			}
		}
		out = append(out, Skill{
			Name:        name,
			Kind:        kind,
			Description: strings.TrimSpace(fm.Description),
			SkillMD:     string(raw),
			References:  refs,
			ContentSHA:  contentSHA(string(raw), refs),
		})
	}
	return out, nil
}
