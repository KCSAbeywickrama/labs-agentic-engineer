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

package design

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/models"
)

// Generic conditional skill attachment (Task G4,
// learning/thunder-resource/PLAN-generalization.md): a `platform-resource`
// dependency whose ClusterResourceType carries the PE-authored
// `aep.wso2.com/skill` annotation (resources.TypeMarkers.Skill) means the
// design needs that skill's agent instructions to work with the dependency —
// so design save ensures the skill name is present in the OWNING component's
// skillsApplied (per-component design.json — see
// models.DesignComponent.SkillsApplied). Membership keys ONLY on the CRT
// annotation, never on a resourceType name or component type: any dependency
// kind carrying the marker qualifies, exactly like deriveEndUserAuth keys on
// the role label rather than a hardcoded name.
//
// This is append-only by design: a component's skillsApplied may carry
// entries from other sources (generation-time skill selection, manual
// edits), and this pass must never remove or reorder them — it only ever
// adds a missing name, once, to the component that declared the dependency.
// An unresolvable/unknown skill name is deliberately NOT validated here: it is
// attached as-authored on the CRT, and the downstream resolve layer
// (skills.SkillService.ResolveMany, read at execution time via
// execution.SkillsService.SkillsForExecution) already tolerates a missing
// skill name by warning and omitting it rather than failing — see
// skills/repo_store.go's ResolveMany. A PE typo in the annotation must not
// brick every save of every design that happens to depend on that type.

// attachAnnotatedSkills ensures every skill named by a component's
// platform-resource dependency CRT annotation is present in THAT component's
// SkillsApplied (append-only, de-duplicated within the component). Returns the
// names of components that gained at least one skill. A nil/empty markers map
// (no platform-resource dependency in the design, or none of its types carry
// the annotation) changes nothing.
func attachAnnotatedSkills(designFile *artifacts.DesignFile, markers map[string]resources.TypeMarkers) []string {
	var changed []string
	for i := range designFile.Components {
		comp := &designFile.Components[i]
		present := make(map[string]struct{}, len(comp.SkillsApplied))
		for _, name := range comp.SkillsApplied {
			present[name] = struct{}{}
		}
		added := false
		for _, dep := range comp.Dependencies {
			if dep.Kind != models.DependencyKindPlatformResource {
				continue
			}
			skill := markers[dep.ResourceType].Skill
			if skill == "" {
				continue
			}
			if _, ok := present[skill]; ok {
				continue
			}
			present[skill] = struct{}{}
			comp.SkillsApplied = append(comp.SkillsApplied, skill)
			added = true
		}
		if added {
			changed = append(changed, comp.Name)
		}
	}
	return changed
}

// persistSkillsApplied runs attachAnnotatedSkills over designFile and, when it
// added at least one skill to at least one component, commits the changed
// components' design.json files (re-rendered via artifacts.SplitDesign) to
// main via the committed-truth write surface, mirroring
// persistEndUserAuthDerivation's render-CAS-commit shape for the derive_auth
// seam — a single atomic multi-file commit when more than one component
// changed. It runs from SaveAndProceed in the SAME pass and over the SAME
// marker map resourceMarkersForAuthDerivation already fetched — no second
// catalog call.
//
// Returns (true, nil) when a commit landed — the caller must re-resolve HEAD
// (its designFile + any pinned commitSHA are now stale), the same convention
// the auto-fetch-on-save and auth-derivation steps already follow. A nil
// fileCommitter (degraded boot) is a best-effort no-op after a successful
// in-memory attach: the changed components' SkillsApplied still reflect the
// addition for THIS response, but nothing is persisted.
func (s *designService) persistSkillsApplied(ctx context.Context, orgID, projectID string, designFile *artifacts.DesignFile, markers map[string]resources.TypeMarkers) (bool, error) {
	changed := attachAnnotatedSkills(designFile, markers)
	if len(changed) == 0 {
		return false, nil
	}
	if s.fileCommitter == nil {
		return false, nil // degraded boot — in-memory attach still reflects for this response
	}

	// Render the whole design; pick out the changed components' design.json files.
	rendered, rerr := artifacts.SplitDesign(designFile)
	if rerr != nil {
		return false, fmt.Errorf("render design: %w", rerr)
	}

	writes := make([]DesignFileWrite, 0, len(changed))
	for _, name := range changed {
		rel := "components/" + name + "/design.json"
		content, ok := rendered[rel]
		if !ok {
			return false, fmt.Errorf("render design: %q missing from split", rel)
		}
		full := artifacts.DesignDir + "/" + rel
		_, sha, exists, rerr := s.fileCommitter.ReadFile(ctx, orgID, projectID, full)
		if rerr != nil {
			return false, fmt.Errorf("read %q for CAS: %w", full, rerr)
		}
		if !exists {
			return false, fmt.Errorf("%q missing on disk", full)
		}
		writes = append(writes, DesignFileWrite{Path: full, Content: content, BaseSHA: sha})
	}

	if err := s.fileCommitter.Commit(ctx, orgID, projectID, writes,
		"Attach CRT-annotated skills to component designs"); err != nil {
		return false, err
	}
	slog.InfoContext(ctx, "design save: per-component skill auto-attach persisted",
		"org", orgID, "project", projectID, "components", changed)
	return true, nil
}
