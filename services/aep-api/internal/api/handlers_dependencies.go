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
	"strings"

	"github.com/wso2/aep/aep-api/internal/api/apigen"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/repositories"
)

// Dependencies feature on the strict interface: the platform-resource-type
// discovery endpoint (the HTTP transport of the same data the
// list_platform_resource_types MCP tool serves). The catalog itself is
// cluster-global — there is nothing org-scoped to filter by — but the
// operation still sits behind the deny-by-default tenant gate like every
// other one (the auth fence), and that bound org is what scopes the
// per-type `consumers` overlay (below). A nil catalog answers 503, mirroring
// the retired RegisterResourceTypes nil guard.

func (s *apiServer) ListPlatformResourceTypes(ctx context.Context, _ apigen.ListPlatformResourceTypesRequestObject) (apigen.ListPlatformResourceTypesResponseObject, error) {
	if s.deps.ResourceTypeCatalog == nil {
		return nil, errServiceUnavailable("resource-type catalog is not configured")
	}
	types, err := s.deps.ResourceTypeCatalog.List(ctx)
	if err != nil {
		// The catalog reads cluster ClusterResourceTypes over OpenChoreo; a
		// failure is an upstream (data-plane) fault, not the caller's.
		return nil, errBadGateway("failed to list platform resource types")
	}
	// The "used by" overlay: which of the CALLING org's components declare a
	// platform-resource dependency on each type. This is org-scoped (unlike the
	// catalog above), so it is computed by the provisioning service — the same
	// collaborator that scans committed designs for external-resource consumers
	// — rather than the cluster-global ResourceTypeCatalog. A nil/unwired
	// ProvisioningSvc degrades to no consumers rather than failing the request:
	// the type catalog is the primary data, the overlay is additive.
	var consumersByType map[string][]repositories.ExternalResourceConsumer
	if s.deps.ProvisioningSvc != nil {
		org := tenant.BoundOrgFromContext(ctx)
		consumersByType, err = s.deps.ProvisioningSvc.PlatformResourceConsumersByType(ctx, org)
		if err != nil {
			return nil, errInternal("failed to list platform resource consumers")
		}
	}
	return apigen.ListPlatformResourceTypes200JSONResponse(toPlatformResourceTypeDTOs(types, consumersByType)), nil
}

// toPlatformResourceTypeDTOs projects the domain resource types onto the wire
// DTO: the architect-facing fields (name, description, parameters, outputs)
// minus the AEP-internal markers, plus the org-scoped consumers overlay
// (keyed by lowercased type name — same normalization
// PlatformResourceConsumersByType groups on) merged in per type. A nil overlay
// (unwired provisioning) simply leaves every type's Consumers empty.
func toPlatformResourceTypeDTOs(in []resources.PlatformResourceType, consumersByType map[string][]repositories.ExternalResourceConsumer) []apigen.PlatformResourceTypeDTO {
	out := make([]apigen.PlatformResourceTypeDTO, 0, len(in))
	for _, t := range in {
		var consumers []apigen.ConsumerDTO
		for _, c := range consumersByType[strings.ToLower(t.Name)] {
			consumers = append(consumers, apigen.ConsumerDTO{ProjectID: c.ProjectID, ComponentName: c.ComponentName})
		}
		out = append(out, apigen.PlatformResourceTypeDTO{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
			Outputs:     t.Outputs,
			Consumers:   consumers,
		})
	}
	return out
}
