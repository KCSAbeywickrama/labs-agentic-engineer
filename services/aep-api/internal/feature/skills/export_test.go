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

// The Go export_test.go pattern: exported test-only helpers that let the
// EXTERNAL component-test package (skills_test, which must live outside package
// skills to break the api→skills import cycle) build a REAL *SkillService over
// the in-memory fake GitHub the repo_store_test.go pattern already provides —
// without duplicating the ~180-line fake or reaching its unexported doubles.
// These symbols are compiled only into the test binary.

import (
	"fmt"

	"github.com/wso2/aep/aep-api/models"
)

// ComponentStore is an exported handle around a real SkillService backed by the
// in-process fake GitHub (newMemGit + fakeGitOps + fakeRepoSvc from
// repo_store_test.go). The component tier wires Svc into api.HumaDeps and drives
// the real HTTP chain against it end-to-end.
type ComponentStore struct {
	Svc   *SkillService
	gh    *memGit
	repos *fakeRepoSvc
}

// NewComponentStore builds a SkillService over a fresh fake GitHub. The first
// read for an org lazily provisions the repo and seeds the embedded built-ins,
// exactly as production does.
func NewComponentStore() *ComponentStore {
	gh := newMemGit()
	repos := &fakeRepoSvc{repos: map[string]*models.GitRepository{}}
	svc := NewSkillService(&fakeGitOps{gh: gh}, repos)
	return &ComponentStore{Svc: svc, gh: gh, repos: repos}
}

// DowngradeBuiltin rewrites a built-in's SKILL.md in the fake repo (advancing
// HEAD) and evicts the org's cache, so a subsequent read/UpdatesAvailable sees
// a repo copy BEHIND the embedded version — the state that drives the
// "updates available" badge. The repo row already exists after the first read,
// so this write is not re-reconciled away.
func (c *ComponentStore) DowngradeBuiltin(orgID, name, skillMD string) {
	c.gh.writeAtHead(skillRepoPath("builtin", name), skillMD)
	c.Svc.cache.evict(orgID)
}

// writeAtHead records a NEW commit that adds/overwrites a path (mirrors
// memGit.removeAtHead in repo_store_test.go), so the store's HEAD-sha
// revalidation detects the content change.
func (m *memGit) writeAtHead(path, content string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := cloneMap(m.snapshots[m.head])
	next[path] = content
	newHead := fmt.Sprintf("c-wr%d", m.seq)
	m.seq++
	m.snapshots[newHead] = next
	m.head = newHead
}
