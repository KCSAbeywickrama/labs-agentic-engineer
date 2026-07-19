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

package api

import (
	"context"
	"errors"

	"github.com/wso2/aep/aep-api/internal/api/apigen"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/models"
)

// designDependencyReader is the api package's narrow consumer port over the
// design feature: read every component's dependencies in the current design,
// with read-time computed status/reason. The design feature deliberately
// exports no service interface (feature/design/design_service.go: "every
// caller holds the concrete type") — mirroring how design itself declares
// narrow consumer ports for ITS OWN collaborators (taskReconciler,
// resourceMarkerCatalog, externalResourceRegistrar, ...), this port is
// declared consumer-side instead; *design's unexported designService
// satisfies it structurally.
type designDependencyReader interface {
	ListDependencies(ctx context.Context, orgID, projectID string) ([]models.DesignComponent, error)
}

// ListDesignDependencies is the design feature's read-only dependency-status
// surface: every component's dependencies in the current design, with the
// read-time computed status/reason (ReadDesign → AssembleDesignFrom already
// ran models.ComputeDependencyStatus per dependency) plus the stored intent
// fields — the single read model the console's dependency-status views poll.
// A nil service answers 503 (the design feature is unwired), mirroring every
// other feature's nil-guard (e.g. errProvisioningUnavailable).
func (s *apiServer) ListDesignDependencies(ctx context.Context, request apigen.ListDesignDependenciesRequestObject) (apigen.ListDesignDependenciesResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)
	if s.deps.DesignSvc == nil {
		return nil, errServiceUnavailable("design service is not configured")
	}
	components, err := s.deps.DesignSvc.ListDependencies(ctx, org, request.ProjectName)
	if err != nil {
		if errors.Is(err, artifacts.ErrDesignNotFound) {
			return nil, errNotFound("design not found")
		}
		return nil, errInternal("failed to read design dependencies")
	}
	out := make([]apigen.ComponentDependencies, 0, len(components))
	for _, c := range components {
		deps := c.Dependencies
		if deps == nil {
			deps = []models.Dependency{}
		}
		out = append(out, apigen.ComponentDependencies{
			ComponentName: c.Name,
			Dependencies:  deps,
		})
	}
	return apigen.ListDesignDependencies200JSONResponse(out), nil
}
