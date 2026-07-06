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

package skills

// Repo-backed skills store. The per-org `org-skills` GitHub repo is the
// single source of truth (docs/design/skills-repo-storage.md); the store
// reads and writes it through the Workspace port over the shared-volume
// mirror (docs/design/shared-volume-clone-architecture.md, Phase 1):
//
//   - reads are one ReadBundle at the branch tip (fetch + local plumbing —
//     REST-parity freshness; no cache tier);
//   - writes are one Mutate commit to `main`; Mutate owns the CAS retry
//     (no per-feature retry wrapper).
//
// Built-ins and flow skills are seeded + version-reconciled from the embedded
// container files (reconcile.go). The exported read surface (Resolve/List/
// ListSummaries/ResolveMany) is IDENTICAL to the previous store, so the
// architect and tech-lead resolvers consume it unchanged.

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

const (
	// SkillsRepoName is the stable per-org GitHub repo name. §10.1.
	SkillsRepoName = "org-skills"
	// SkillsRepoProject is the sentinel project_id under which the skills repo
	// row lives in git_repositories (distinguishes it from project repos). §10.1.
	SkillsRepoProject = models.SkillsRepoSentinelProjectID

	skillsRootDir = "skills"
	skillFileName = "SKILL.md"
	refsPrefix    = "references/"
)

// validKinds is the set of kind path-segments under skills/. §8. "flow" is the
// platform's generation flow skills (shared-volume-clone-architecture §17.8):
// part of the internal catalog, hidden from the user-facing skills surface.
var validKinds = map[string]bool{"builtin": true, "custom": true, "imported": true, "flow": true}

// SkillService is the repo-backed read/reconcile surface for skills. It also
// holds the low-level git read/write primitives that the mutation + import
// services and the reconciler compose with.
type SkillService struct {
	git   gitrepo.GitOpsService
	repos gitrepo.RepoService
	// provLocks serialises first-time provisioning per org. The gitfs flock +
	// origin push-CAS make concurrent WRITES safe, but they cannot make the
	// first page load deterministic: EnsureBareRepo creates the GitHub repo
	// and inserts the row BEFORE the seed commit lands, so an unguarded
	// concurrent reader could observe the row and list a still-empty repo (and
	// two concurrent provisions would both hit the GitHub create API —
	// adopt-on-conflict keeps that correct, but noisy). Uncontended ~1ms row
	// lookup once the repo exists.
	provLocks sync.Map // orgID → *sync.Mutex
}

func (s *SkillService) orgLock(orgID string) *sync.Mutex {
	v, _ := s.provLocks.LoadOrStore(orgID, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// NewSkillService wires the repo-backed store. `git` provides the Workspace
// engine, credential resolver, and save identities; `repos` provisions/looks
// up the per-org skills repo row. Either may be nil in degraded/test boot
// (reads then return empty).
func NewSkillService(git gitrepo.GitOpsService, repos gitrepo.RepoService) *SkillService {
	return &SkillService{git: git, repos: repos}
}

// ---- read surface (unchanged contract) -------------------------------------

// findByName returns a copy of the first skill whose name matches, or nil.
// The copy avoids aliasing the range variable in the returned pointer.
func findByName(skills []Skill, name string) *Skill {
	for _, sk := range skills {
		if sk.Name == name {
			out := sk
			return &out
		}
	}
	return nil
}

// findVisibleByName is findByName restricted to non-flow kinds. Flow skills
// are invisible to the by-name user surface (get/update/delete) so the skills
// page semantics are unchanged by their presence in the repo — but their
// names stay reserved via the unfiltered collision check (resolveFresh).
func findVisibleByName(skills []Skill, name string) *Skill {
	for _, sk := range skills {
		if sk.Name == name && sk.Kind != "flow" {
			out := sk
			return &out
		}
	}
	return nil
}

// Resolve returns a single skill by name visible to the org. A custom/imported
// skill shadows a builtin of the same name (org wins), matching the prior
// DB-backed union semantics. Flow skills are not resolvable by name — they are
// internal to the generation flows.
func (s *SkillService) Resolve(ctx context.Context, orgID, name string) (*Skill, error) {
	return findVisibleByName(s.catalog(ctx, orgID), name), nil
}

// resolveFresh resolves a single skill of ANY kind (flow included — a
// same-named custom/imported skill would shadow the flow skill in the deduped
// catalog and duplicate it in Phase-4 snapshots, so flow names stay reserved)
// with read errors SURFACED rather than degraded. Used by the create/import
// collision checks so a transient read failure yields an error rather than a
// phantom "no collision". This narrows — but cannot eliminate — the
// cross-replica TOCTOU window: git has no unique constraint
// (docs/design/skills-repo-storage.md §9).
func (s *SkillService) resolveFresh(ctx context.Context, orgID, name string) (*Skill, error) {
	if s == nil || s.git == nil || s.repos == nil || orgID == "" {
		return nil, nil
	}
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		return nil, err
	}
	skills, err := s.loadCatalog(ctx, orgID, repo)
	if err != nil {
		return nil, err
	}
	return findByName(skills, name), nil
}

// List returns every skill visible to the org (including flow skills — the
// internal catalog), sorted by kind then name. Callers that feed user-facing
// or per-turn surfaces filter kinds themselves (ListSummaries hides flow; the
// genai aux-skill feed skips builtin + flow).
func (s *SkillService) List(ctx context.Context, orgID string) ([]Skill, error) {
	return s.catalog(ctx, orgID), nil
}

// ListSummaries is the skills-page projection: List() minus flow skills,
// projected to (name, kind, version, description, ...).
func (s *SkillService) ListSummaries(ctx context.Context, orgID string) ([]SkillSummary, error) {
	skills := s.catalog(ctx, orgID)
	out := make([]SkillSummary, 0, len(skills))
	for _, sk := range skills {
		if sk.Kind == "flow" {
			continue // generation flow skills never surface on the skills page
		}
		out = append(out, SkillSummary{
			Name:        sk.Name,
			Kind:        sk.Kind,
			Version:     sk.Version,
			Description: sk.Description,
			ContentSHA:  sk.ContentSHA,
			Editable:    sk.Kind != "builtin",
		})
	}
	return out, nil
}

// ResolveMany fans Resolve over names, preserving order; missing names are
// omitted (the caller may compare lengths to detect drops).
func (s *SkillService) ResolveMany(ctx context.Context, orgID string, names []string) ([]Skill, error) {
	byName := make(map[string]Skill)
	for _, sk := range s.catalog(ctx, orgID) {
		byName[sk.Name] = sk
	}
	out := make([]Skill, 0, len(names))
	for _, n := range names {
		if sk, ok := byName[n]; ok {
			out = append(out, sk)
			continue
		}
		slog.WarnContext(ctx, "skill resolve missing", "orgID", orgID, "name", n)
	}
	return out, nil
}

// ---- catalog loading ---------------------------------------------------------

// catalog returns the org's skills at the branch tip, degrading to empty on
// any git/provisioning failure so a transient outage never fails a design/task
// run. §12.
func (s *SkillService) catalog(ctx context.Context, orgID string) []Skill {
	if s == nil || s.git == nil || s.repos == nil || orgID == "" {
		return nil
	}
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		slog.WarnContext(ctx, "skills: ensure repo failed — serving empty", "org", orgID, "error", err)
		return nil
	}
	skills, err := s.loadCatalog(ctx, orgID, repo)
	if err != nil {
		slog.WarnContext(ctx, "skills: load catalog failed — serving empty", "org", orgID, "error", err)
		return nil
	}
	return skills
}

// loadCatalog reads skills/ at the branch tip: one Workspace.ReadBundle
// (fetch + local ls-tree/cat-file) filtered to the catalog layout, parsed
// in-memory. Branch-tip reads always revalidate origin, so freshness matches
// the retired REST walk without any cache.
func (s *SkillService) loadCatalog(ctx context.Context, orgID string, repo *models.GitRepository) ([]Skill, error) {
	ref, err := gitrepo.ResolveWorkspaceRef(ctx, s.git.Resolver(), orgID, repo)
	if err != nil {
		return nil, err
	}
	files, _, err := s.git.Workspace().ReadBundle(ctx, ref, "", isCatalogPath)
	if err != nil {
		return nil, fmt.Errorf("read skills bundle: %w", err)
	}
	return parseBundle(ctx, files), nil
}

// isCatalogPath keeps exactly the blobs the catalog is parsed from:
// skills/<kind>/<name>/SKILL.md and skills/<kind>/<name>/references/*.md.
func isCatalogPath(rel string) bool {
	parts := strings.Split(rel, "/")
	if len(parts) < 4 || parts[0] != skillsRootDir || !validKinds[parts[1]] {
		return false
	}
	rest := strings.Join(parts[3:], "/")
	return rest == skillFileName ||
		(strings.HasPrefix(rest, refsPrefix) && strings.HasSuffix(rest, ".md"))
}

// parseBundle turns a path→content bundle into the sorted, deduped skill set.
// Same shape rules as isCatalogPath (re-checked defensively — the keep filter
// is an optimization, not the contract).
func parseBundle(ctx context.Context, files map[string]string) []Skill {
	type key struct{ kind, name string }
	bodies := map[key]string{}
	refs := map[key]map[string]string{}

	for path, content := range files {
		parts := strings.Split(path, "/")
		if len(parts) < 4 || parts[0] != skillsRootDir || !validKinds[parts[1]] {
			continue
		}
		k := key{kind: parts[1], name: parts[2]}
		rest := strings.Join(parts[3:], "/")
		switch {
		case rest == skillFileName:
			bodies[k] = content
		case strings.HasPrefix(rest, refsPrefix) && strings.HasSuffix(rest, ".md"):
			if refs[k] == nil {
				refs[k] = map[string]string{}
			}
			refs[k][rest] = content
		}
	}

	// Dedup by name; a custom/imported skill shadows a same-named builtin/flow
	// ("org wins") via kind precedence, so map iteration order doesn't matter.
	deduped := map[string]Skill{}
	for k := range bodies {
		if existing, ok := deduped[k.name]; ok && kindRank(existing.Kind) >= kindRank(k.kind) {
			continue
		}
		r := refs[k]
		if r == nil {
			r = map[string]string{}
		}
		fm, _, err := parseSkillMD(bodies[k])
		if err != nil {
			slog.WarnContext(ctx, "skills: skipping unparseable SKILL.md", "kind", k.kind, "name", k.name, "error", err)
			continue
		}
		deduped[k.name] = Skill{
			Name:          k.name,
			Kind:          k.kind,
			Description:   strings.TrimSpace(fm.Description),
			SkillMD:       bodies[k],
			References:    r,
			Version:       versionFromMetadata(fm),
			ContentSHA:    contentSHA(bodies[k], r),
			License:       fm.License,
			Compatibility: fm.Compatibility,
		}
	}

	out := make([]Skill, 0, len(deduped))
	for _, sk := range deduped {
		out = append(out, sk)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return kindRank(out[i].Kind) < kindRank(out[j].Kind)
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// ---- low-level write primitive ---------------------------------------------

// commitFiles applies a set of blob writes + path/prefix deletes to the skills
// repo's default branch in a single commit through Workspace.Mutate, which
// owns the bounded fast-forward CAS retry (design D5). §9.
func (s *SkillService) commitFiles(ctx context.Context, orgID string, repo *models.GitRepository, message string, writes map[string][]byte, deletePrefixes []string) (string, error) {
	ref, err := gitrepo.ResolveWorkspaceRef(ctx, s.git.Resolver(), orgID, repo)
	if err != nil {
		return "", err
	}
	author, committer := s.git.ResolveSaveIdentities(ref.Cred)

	res, err := s.git.Workspace().Mutate(ctx, ref, func(tx gitrepo.Tx) error {
		// Deletes are staged BEFORE writes: Tx is last-op-wins per path, so a
		// path also being written this commit survives its own prefix delete
		// (e.g. a reference file being replaced under a pruning update).
		for _, prefix := range deletePrefixes {
			if err := tx.Base().Walk(prefix, func(rel, _ string) error {
				// Walk matches by raw string prefix; keep the exact historical
				// semantics — the path itself or anything under it as a dir.
				if rel == prefix || strings.HasPrefix(rel, prefix+"/") {
					tx.Delete(rel)
				}
				return nil
			}); err != nil {
				return fmt.Errorf("walk %q for delete: %w", prefix, err)
			}
		}
		for p, data := range writes {
			tx.Write(p, data)
		}
		return nil
	}, gitrepo.CommitOpts{Message: message, Author: author, Committer: committer})
	if err != nil {
		return "", err
	}
	// Changed=false (nothing staged / identical content) returns the unchanged
	// tip — same contract as the retired REST path.
	return res.CommitSHA, nil
}

// writeSkillFiles commits a skill's SKILL.md + references under
// skills/<kind>/<name>/. When pruneStaleRefs is set (updates), reference files
// present in the repo but absent from the new set are removed in the same
// commit (the SKILL.md path and any reference being rewritten are protected
// from the delete). Creates/imports pass pruneStaleRefs=false: there is nothing
// to prune for a brand-new skill. Used by the mutation + import services and
// the reconciler. §9.
func (s *SkillService) writeSkillFiles(ctx context.Context, orgID, kind, name, skillMD string, references map[string]string, message string, pruneStaleRefs bool) error {
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		return err
	}
	writes := map[string][]byte{skillRepoPath(kind, name): []byte(skillMD)}
	for refKey, content := range references {
		writes[skillRefPath(kind, name, refKey)] = []byte(content)
	}
	var deletes []string
	if pruneStaleRefs {
		// Sweep the references/ subtree so removed refs don't linger; commitFiles
		// stages writes after deletes, so rewritten refs win.
		deletes = []string{skillRepoDir(kind, name) + "/" + strings.TrimSuffix(refsPrefix, "/")}
	}
	_, err = s.commitFiles(ctx, orgID, repo, message, writes, deletes)
	return err
}

// deleteSkillDir removes a skill's whole directory in one commit. §9.
func (s *SkillService) deleteSkillDir(ctx context.Context, orgID, kind, name, message string) error {
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		return err
	}
	_, err = s.commitFiles(ctx, orgID, repo, message, nil, []string{skillRepoDir(kind, name)})
	return err
}

// ---- helpers ---------------------------------------------------------------

// kindRank orders builtin < flow < custom < imported. builtin/custom/imported
// keep their prior relative order (matches the old `ORDER BY kind`); flow sits
// with the platform-owned kinds so a custom/imported skill shadows a same-named
// flow skill in the deduped catalog ("org wins").
func kindRank(kind string) int {
	switch kind {
	case "builtin":
		return 0
	case "flow":
		return 1
	case "custom":
		return 2
	case "imported":
		return 3
	default:
		return 4
	}
}

// skillRepoDir is the canonical directory for a skill (the layout is defined
// here once; the file/ref paths below compose from it). §8.
func skillRepoDir(kind, name string) string {
	return skillsRootDir + "/" + kind + "/" + name
}

// skillRepoPath is the canonical repo path for a skill's SKILL.md. §8.
func skillRepoPath(kind, name string) string {
	return skillRepoDir(kind, name) + "/" + skillFileName
}

// skillRefPath maps a "references/foo.md" key to its repo path.
func skillRefPath(kind, name, refKey string) string {
	return skillRepoDir(kind, name) + "/" + refKey
}
