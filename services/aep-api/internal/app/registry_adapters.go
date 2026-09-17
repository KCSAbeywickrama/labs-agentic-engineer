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

package app

import (
	"context"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/dependencies"
	"github.com/wso2/aep/aep-api/internal/dependencies/provisioning"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// registeredResourceReader adapts the org resource registry — the OC-RT-backed
// catalog plus the org docs repo — onto spec.RegisteredResourceReader, the
// port the design write path copies a Registered External resource through.
// spec names no feature type: the projection from the client's record shape
// to the shared ResourceDefinition happens here.
type registeredResourceReader struct {
	catalog *dependencies.ExternalResourceCatalog
	docs    provisioning.OrgResourceDocs
}

func (r registeredResourceReader) RegisteredResource(ctx context.Context, orgID, name string) (*spec.RegisteredResource, error) {
	if r.catalog == nil {
		return nil, fmt.Errorf("external resource catalog is not configured")
	}
	def, err := r.catalog.Get(ctx, orgID, name)
	if err != nil {
		return nil, err
	}
	if def == nil || !def.Registered() {
		return nil, nil
	}
	out := &spec.RegisteredResource{Resource: resourceDefinitionFromRecord(*def)}
	if def.Contract != nil && r.docs != nil {
		doc, err := r.docs.ReadUTF8(ctx, orgID, def.Contract.Path)
		if err != nil {
			return nil, fmt.Errorf("read registered resource %q document: %w", name, err)
		}
		out.Document = doc
	}
	return out, nil
}

// resourceDefinitionFromRecord projects the catalog's record onto the shared
// resource shape. Values are never part of either.
func resourceDefinitionFromRecord(def openchoreo.ExternalResourceDefinition) spec.ResourceDefinition {
	res := spec.ResourceDefinition{
		Name:                    def.Name,
		Description:             def.Description,
		Provider:                def.Provider,
		ConsumptionInstructions: def.ConsumptionInstructions,
	}
	for _, k := range def.Config {
		res.Config = append(res.Config, spec.ConfigKey{Key: k.Key, Secret: k.Secret, Description: k.Description, DefaultValue: k.DefaultValue})
	}
	if def.Contract != nil {
		res.Contract = &spec.ResourceContract{Type: def.Contract.Type, Path: def.Contract.Path}
	}
	if def.Provenance != nil {
		res.Provenance = &spec.ResourceProvenance{SourceURL: def.Provenance.SourceURL, SHA256: def.Provenance.SHA256, ReadOn: def.Provenance.ReadOn}
	}
	return res
}
