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

package resources

import (
	"context"
	"sort"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
)

// ExternalResourceCatalog is the read-only MCP-facing external-resource
// registry (dependencies.ExternalResourceReader), sourced from the org's
// namespaced OpenChoreo ResourceTypes instead of the external_resources
// table: each entry is reconstructed off an authored RT via
// openchoreo.ExternalDefinitionFromRT. Mirrors ResourceTypeCatalog above,
// scoped to one org namespace instead of the cluster.
//
// Only a PROVISIONED `external` dependency has an authored RT (the
// provisioner authors it — see resources.NewExternalResourceProvisioner), so
// this catalog reflects provisioned externals only: a design-only `external`
// dependency that has not yet been provisioned is not discoverable here (D2 —
// deliberate; no design-sweep is added).
type ExternalResourceCatalog struct{ rc openchoreo.ResourceClient }

// NewExternalResourceCatalog wires the read-only discovery over the OC client.
func NewExternalResourceCatalog(rc openchoreo.ResourceClient) *ExternalResourceCatalog {
	return &ExternalResourceCatalog{rc: rc}
}

// List returns every provisioned external resource registered in orgID's
// namespace, reconstructed from its authored ResourceType and sorted by name.
// A namespaced ResourceType that is not self-describing as an external
// (openchoreo.ExternalDefinitionFromRT's ok=false — e.g. it lacks the
// aep.openchoreo.dev/external-name annotation) is silently skipped: it is not
// an external-resource RT.
func (c *ExternalResourceCatalog) List(ctx context.Context, orgID string) ([]openchoreo.ExternalResourceDefinition, error) {
	rts, err := c.rc.ListResourceTypes(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]openchoreo.ExternalResourceDefinition, 0, len(rts))
	for i := range rts {
		def, ok := openchoreo.ExternalDefinitionFromRT(&rts[i])
		if !ok {
			continue
		}
		out = append(out, def)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Get returns the named external resource's definition, or (nil, nil) when no
// provisioned RT in orgID's namespace carries that logical name. The RT's own
// metadata.name is a hash of (name, schema) — see
// openchoreo.ExternalResourceRTName — so it can never be derived from name
// alone; listing every namespaced RT and matching on the recovered logical
// name (via ExternalDefinitionFromRT) is the only way to look one up.
func (c *ExternalResourceCatalog) Get(ctx context.Context, orgID, name string) (*openchoreo.ExternalResourceDefinition, error) {
	rts, err := c.rc.ListResourceTypes(ctx, orgID)
	if err != nil {
		return nil, err
	}
	for i := range rts {
		def, ok := openchoreo.ExternalDefinitionFromRT(&rts[i])
		if ok && def.Name == name {
			return &def, nil
		}
	}
	return nil, nil
}
