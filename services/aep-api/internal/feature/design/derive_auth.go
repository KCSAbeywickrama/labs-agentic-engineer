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
	"github.com/wso2/aep/aep-api/models"
)

// Auth-as-platform-resource (learning/thunder-resource/PLAN.md): a `service`
// component that declares a `platform-resource` dependency with
// `resourceType: "thunder-app"` gets end-user gateway auth on its managed API
// for free — the platform derives `exposesAPI.auth` from the dependency
// instead of requiring the architect (or a human editor) to author it
// separately. The two must never disagree: an explicit `service-required` on
// such a component is a self-contradiction (the dependency says "this API
// sits behind the end-user login the SPA performs via thunder-app"; the flag
// says "no end-user ever reaches this API") and is rejected as a validation
// error rather than silently overridden.
const (
	thunderAppResourceType = "thunder-app"
	authEndUserRequired    = "end-user-required"
	authServiceRequired    = "service-required"
)

// deriveEndUserAuth stamps exposesAPI.auth=end-user-required on service
// components that declare a thunder-app platform-resource dependency, and
// rejects an explicit conflicting service-required as a validation error.
// Mutates components in place. web-app components and services with no
// thunder-app dependency (including a platform-resource dependency of some
// OTHER resourceType, e.g. postgres-cnpg) are left completely untouched: SPAs
// aren't gateway-exposed managed APIs, and a bare dependency-less/differently-
// typed service has nothing to derive from. On a conflict, nothing in
// components is mutated — the caller sees the original, unmodified state.
func deriveEndUserAuth(components []models.DesignComponent) error {
	for i := range components {
		comp := &components[i]
		if comp.ComponentType != "service" {
			continue
		}
		dep, ok := thunderAppDependency(comp.Dependencies)
		if !ok {
			continue
		}
		if comp.ExposesAPI != nil && comp.ExposesAPI.Auth == authServiceRequired {
			return fmt.Errorf(
				"component %q: dependency %q (platform-resource, resourceType %q) requires exposesAPI.auth=%q, but the component explicitly declares exposesAPI.auth=%q",
				comp.Name, dep.Name, thunderAppResourceType, authEndUserRequired, comp.ExposesAPI.Auth,
			)
		}
		if comp.ExposesAPI == nil {
			comp.ExposesAPI = &models.ExposesAPI{}
		}
		comp.ExposesAPI.Auth = authEndUserRequired
	}
	return nil
}

// thunderAppDependency returns the first thunder-app platform-resource
// dependency in deps, if any.
func thunderAppDependency(deps []models.Dependency) (models.Dependency, bool) {
	for _, d := range deps {
		if d.Kind == models.DependencyKindPlatformResource && d.ResourceType == thunderAppResourceType {
			return d, true
		}
	}
	return models.Dependency{}, false
}

// exposesAPIEqual reports whether two (possibly nil) ExposesAPI pointers
// describe the same value — used to detect which components deriveEndUserAuth
// actually changed, so persistEndUserAuthDerivation commits only those.
func exposesAPIEqual(a, b *models.ExposesAPI) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// persistEndUserAuthDerivation runs deriveEndUserAuth over designFile's
// components and, for every component it stamps, commits the updated
// design.json to main via the committed-truth write surface (the same
// designFileCommitter port + per-component SplitDesign render CollectSpec
// uses). It runs from SaveAndProceed BEFORE the tag-cut, so a thunder-app
// dependency's derived exposesAPI.auth is already on disk — and therefore
// already what the NEXT design read sees (EnsureComponent's create-time trait
// derivation, component.TraitSyncService, the Explorer) — by the time
// anything downstream (dispatch, OC) acts on the tagged design.
//
// Returns (true, nil) when at least one commit landed — the caller must then
// re-resolve HEAD (its designFile + any pinned commitSHA are now stale), the
// same convention SaveAndProceed's auto-fetch-on-save step already follows.
// Returns a non-nil error (wrapping ErrEndUserAuthConflict) with NO commit
// attempted when deriveEndUserAuth itself rejects the design — the save must
// stop there, exactly like the unresolved-dependency proceed-gate.
//
// A nil fileCommitter (degraded boot — mirrors CollectSpec) is a best-effort
// no-op after a successful derivation: designFile.Components is still mutated
// in place so THIS response reflects the derived value, but nothing is
// persisted, so it will not survive to the next independent design read.
func (s *designService) persistEndUserAuthDerivation(ctx context.Context, orgID, projectID string, designFile *artifacts.DesignFile) (bool, error) {
	// Snapshot a COPY of each ExposesAPI value (not the pointer): when a
	// component already carries a non-nil ExposesAPI, deriveEndUserAuth
	// mutates its Auth field THROUGH that same pointer — capturing the
	// pointer itself here would alias the post-mutation value and the
	// change-detection below would never see a diff.
	before := make([]*models.ExposesAPI, len(designFile.Components))
	for i, c := range designFile.Components {
		if c.ExposesAPI != nil {
			v := *c.ExposesAPI
			before[i] = &v
		}
	}
	if err := deriveEndUserAuth(designFile.Components); err != nil {
		return false, fmt.Errorf("%w: %v", ErrEndUserAuthConflict, err)
	}
	if s.fileCommitter == nil {
		return false, nil
	}

	var writes []DesignFileWrite
	for i := range designFile.Components {
		if exposesAPIEqual(before[i], designFile.Components[i].ExposesAPI) {
			continue
		}
		comp := designFile.Components[i]
		rendered, rerr := artifacts.SplitDesign(&artifacts.DesignFile{Components: []models.DesignComponent{comp}})
		if rerr != nil {
			return false, fmt.Errorf("render component %q design.json: %w", comp.Name, rerr)
		}
		designSub := "components/" + comp.Name + "/design.json"
		content, ok := rendered[designSub]
		if !ok {
			return false, fmt.Errorf("render component %q design.json: %q missing from split", comp.Name, designSub)
		}
		designFull := artifacts.DesignDir + "/" + designSub
		_, sha, exists, rerr := s.fileCommitter.ReadFile(ctx, orgID, projectID, designFull)
		if rerr != nil {
			return false, fmt.Errorf("read %q for CAS: %w", designFull, rerr)
		}
		if !exists {
			return false, fmt.Errorf("component %q design.json missing on disk", comp.Name)
		}
		writes = append(writes, DesignFileWrite{Path: designFull, Content: content, BaseSHA: sha})
	}
	if len(writes) == 0 {
		return false, nil
	}
	if err := s.fileCommitter.Commit(ctx, orgID, projectID, writes,
		"Derive exposesAPI.auth from thunder-app dependency"); err != nil {
		return false, err
	}
	slog.InfoContext(ctx, "design save: derived end-user-required auth persisted",
		"org", orgID, "project", projectID, "components", len(writes))
	return true, nil
}
