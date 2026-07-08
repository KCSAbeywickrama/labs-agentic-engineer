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

// Provisioning + embedded-skill reconciliation. Two embedded kinds ship in the
// BFF container (the shipping vehicle) and are seeded + reconciled into
// each org's skills repo (the live store): built-ins (builtin/, coding-agent
// skills on the skills page) and flow skills (flow/, generation flow skills,
// hidden from the page — shared-volume-clone-architecture §17.8 decision (a)).
// docs/design/skills-repo-storage.md §6 (reconcile) and §10 (provisioning).
// User-modification protection is deferred (§6.4) — reconcile is content-hash
// based: absent → seed; embedded content SHA ≠ repo content SHA → overwrite
// (replacing the whole skill dir, so stale references never linger); else
// leave. Retired names the embed no longer ships are purged.

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"path"
	"strings"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
	embedskills "github.com/wso2/aep/aep-api/skills"
)

// SkillUpdate is one row of the "updates available" badge: a built-in whose
// embedded content differs from (or is absent from) the org's repo. §6.3.
type SkillUpdate struct {
	Name string `json:"name"`
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
func (s *SkillService) ensureSkillsRepo(ctx context.Context, orgID string) (*models.GitRepository, error) {
	mu := s.orgLock(orgID)
	mu.Lock()
	defer mu.Unlock()

	repo, err := s.repos.GetRepo(ctx, orgID, SkillsRepoProject)
	if err == nil {
		return repo, nil
	}
	if !errors.Is(err, gitrepo.ErrRepoNotFound) {
		return nil, err
	}
	// First time for this org — create the bare repo and seed the embedded skills.
	repo, err = s.repos.EnsureBareRepo(ctx, orgID, SkillsRepoProject, SkillsRepoName)
	if err != nil {
		return nil, err
	}
	if n, serr := s.reconcileAllEmbedded(ctx, orgID, repo); serr != nil {
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

// Reconcile version-reconciles the embedded skills (built-ins + flow) for an
// org (seed/overwrite/purge/skip). Used by project creation and the admin
// "Sync built-in skills" action. §6.
func (s *SkillService) Reconcile(ctx context.Context, orgID string) (int, error) {
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		return 0, err
	}
	return s.reconcileAllEmbedded(ctx, orgID, repo)
}

// reconcileAllEmbedded reconciles both embedded kinds, returning the total
// number of skills written/purged.
func (s *SkillService) reconcileAllEmbedded(ctx context.Context, orgID string, repo *models.GitRepository) (int, error) {
	nb, err := s.reconcileBuiltins(ctx, orgID, repo)
	if err != nil {
		return nb, err
	}
	nf, err := s.reconcileFlow(ctx, orgID, repo)
	return nb + nf, err
}

// reconcileBuiltins reconciles the embedded built-ins (kind "builtin"). §6.2.
func (s *SkillService) reconcileBuiltins(ctx context.Context, orgID string, repo *models.GitRepository) (int, error) {
	embedded, err := loadEmbeddedBuiltins()
	if err != nil {
		return 0, err
	}
	return s.reconcileEmbedded(ctx, orgID, repo, "builtin", "built-ins", embedded)
}

// reconcileFlow reconciles the embedded generation flow skills (kind "flow")
// into skills/flow/<name>/ — same version-bump semantics as built-ins, so a
// bumped flow skill re-seeds on the next reconcile. §17.8.
func (s *SkillService) reconcileFlow(ctx context.Context, orgID string, repo *models.GitRepository) (int, error) {
	embedded, err := loadEmbeddedFlow()
	if err != nil {
		return 0, err
	}
	return s.reconcileEmbedded(ctx, orgID, repo, "flow", "flow skills", embedded)
}

// reconcileEmbedded writes every embedded skill of one kind that is absent
// from the repo or whose embedded content differs, and purges skills of that
// kind the platform embed no longer ships, in a single commit. A rewritten
// skill's directory is replaced wholesale (delete staged before the writes) so
// references removed by the new content never linger. Returns the number of
// skills written + purged. §6.2.
func (s *SkillService) reconcileEmbedded(ctx context.Context, orgID string, repo *models.GitRepository, kind, label string, embedded []Skill) (int, error) {
	current, err := s.repoContentSHAsByKind(ctx, orgID, repo, kind)
	if err != nil {
		return 0, err
	}

	embeddedNames := make(map[string]bool, len(embedded))
	writes := map[string][]byte{}
	var deletes []string
	written := 0
	for _, b := range embedded {
		embeddedNames[b.Name] = true
		cur, ok := current[b.Name]
		if ok && b.ContentSHA == cur {
			continue
		}
		written++
		// Replace the whole dir: the delete is staged first, the new files win.
		deletes = append(deletes, skillRepoDir(kind, b.Name))
		writes[skillRepoPath(kind, b.Name)] = []byte(b.SkillMD)
		for refKey, content := range b.References {
			writes[skillRefPath(kind, b.Name, refKey)] = []byte(content)
		}
	}
	// Purge skills of this kind the platform embed no longer ships. Without it
	// a retired skill would linger in every org repo forever and keep getting
	// inlined into agent prompts. §6.2.
	purged := 0
	for name := range current {
		if !embeddedNames[name] {
			purged++
			deletes = append(deletes, skillRepoDir(kind, name))
		}
	}

	changed := written + purged
	if changed == 0 {
		return 0, nil
	}
	msg := fmt.Sprintf("chore(skills): reconcile %s (%d written, %d retired)", label, written, purged)
	if _, err := s.commitFiles(ctx, orgID, repo, msg, writes, deletes); err != nil {
		return 0, err
	}
	slog.InfoContext(ctx, "skills: reconciled embedded skills", "org", orgID, "kind", kind, "written", written, "purged", purged)
	return changed, nil
}

// UpdatesAvailable returns the built-ins whose embedded content differs from
// (or is missing from) the org's repo — the data behind the badge. Flow skills
// never surface here: the badge belongs to the skills page, which hides them
// (they still re-reconcile via Reconcile). §6.3.
func (s *SkillService) UpdatesAvailable(ctx context.Context, orgID string) ([]SkillUpdate, error) {
	repo, err := s.ensureSkillsRepo(ctx, orgID)
	if err != nil {
		return nil, err
	}
	embedded, err := loadEmbeddedBuiltins()
	if err != nil {
		return nil, err
	}
	current, err := s.repoContentSHAsByKind(ctx, orgID, repo, "builtin")
	if err != nil {
		return nil, err
	}
	var out []SkillUpdate
	for _, b := range embedded {
		if cur, ok := current[b.Name]; !ok || cur != b.ContentSHA {
			out = append(out, SkillUpdate{Name: b.Name})
		}
	}
	return out, nil
}

// repoContentSHAsByKind reads the current name→content-SHA map for one kind from the
// repo at the branch tip. A skill shadowed in the deduped catalog by a
// same-named higher-precedence kind reads as "absent" and just triggers a
// no-op rewrite (the tree is unchanged, so Mutate commits nothing).
func (s *SkillService) repoContentSHAsByKind(ctx context.Context, orgID string, repo *models.GitRepository, kind string) (map[string]string, error) {
	skills, err := s.loadCatalog(ctx, orgID, repo)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, sk := range skills {
		if sk.Kind == kind {
			out[sk.Name] = sk.ContentSHA
		}
	}
	return out, nil
}

// loadEmbeddedBuiltins reads the bundled builtin/<name>/SKILL.md files from the
// embedded FS into the canonical Skill shape. The embed is the platform's
// shipping vehicle for built-ins; the repo is the live store.
func loadEmbeddedBuiltins() ([]Skill, error) {
	return loadEmbeddedKind(embedskills.BuiltinFS, "builtin", "builtin")
}

// loadEmbeddedFlow reads the bundled flow/<name>/{SKILL.md,references/*.md}
// trees (vendored from the repo-root skills/ source of truth — see
// skills/embed.go) into the canonical Skill shape with kind "flow".
func loadEmbeddedFlow() ([]Skill, error) {
	return loadEmbeddedKind(embedskills.FlowFS, "flow", "flow")
}

// loadEmbeddedKind walks <root>/<name>/SKILL.md (+ optional references/*.md)
// in an embedded FS. Entries without a parseable SKILL.md whose frontmatter
// name matches the directory are skipped with a warning — a bad bundled file
// must never break provisioning.
func loadEmbeddedKind(fsys fs.FS, root, kind string) ([]Skill, error) {
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return nil, fmt.Errorf("read embedded %s dir: %w", root, err)
	}
	out := make([]Skill, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		raw, err := fs.ReadFile(fsys, path.Join(root, name, skillFileName))
		if err != nil {
			slog.Warn("skills: embedded skill read failed", "kind", kind, "name", name, "error", err)
			continue
		}
		fm, _, err := parseSkillMD(string(raw))
		if err != nil {
			slog.Warn("skills: embedded skill parse failed", "kind", kind, "name", name, "error", err)
			continue
		}
		if fm.Name != name {
			slog.Warn("skills: embedded skill name mismatch", "kind", kind, "dir", name, "frontmatter", fm.Name)
			continue
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
					slog.Warn("skills: embedded reference read failed", "kind", kind, "name", name, "ref", r.Name(), "error", err)
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
