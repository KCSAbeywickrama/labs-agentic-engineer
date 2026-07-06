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

// Consumer-side ports. dependencies/resources has an EMPTY arch-allowlist row
// (internal/arch/arch_test.go) — it imports NO other feature package. Every
// collaborator is expressed as a narrow interface here and wired concretely in
// the composition root.

import (
	"context"

	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// externalResourceLookup is the slice of the org-level external-resource
// catalog this package reads. *repositories.ExternalResourceRepository
// satisfies it. Returns (nil, nil) when the name is not registered.
type externalResourceLookup interface {
	Get(ctx context.Context, orgID, name string) (*models.ExternalResource, error)
}

// SecretWriter is the slice of the SM-API writer the provisioner needs.
// Satisfied by *orgcreds.SMAPIWriter.
type SecretWriter interface {
	Enabled() bool
	// WriteExternalResourceSecret uploads the secret fields for a
	// (project, entity) and returns the Vault KV path the ExternalSecret
	// reads (the secretStorePath).
	WriteExternalResourceSecret(ctx context.Context, ocOrgID, projectName, entityName string, data map[string]string) (vaultKey, secretRefName string, err error)
}

// NOTE (dependency-management migration, Phase 2): the task-coupled ports that
// the value/resource services used — TaskStore (read the component_tasks repo),
// TaskCompleter (drive ComponentTask.Status through the projector) and
// RedispatchFunc — were removed here at the merge. Their only consumers
// (external_values.go / resources_service.go) are `git rm`'d until Phase 6, where
// they are rebuilt on our GitHub-native `aep:provision` funnel; the completion
// port they actually need there is "close the provision issue + Funnel.Reevaluate",
// not a component_tasks projector. Trimming them keeps this file compiling with
// component_tasks (and the internal/contracts task seam) gone.

// ExternalResourceRegistry is the slice of the org-level external-resource
// catalog the HTTP surface reads and prunes: the listing (with per-entry
// consumers for the in-use delete guard) and the guarded delete.
// *repositories.ExternalResourceRepository satisfies it directly — per the
// C2 decision there is NO registry wrapper service; repositories is the flat
// shared kernel (not a feature package), so naming its consumer DTO here
// keeps the package's feature-edge allowlist row empty.
type ExternalResourceRegistry interface {
	List(ctx context.Context, orgID string) ([]models.ExternalResource, error)
	Consumers(ctx context.Context, orgID, name string) ([]repositories.ExternalResourceConsumer, error)
	Delete(ctx context.Context, orgID, name string) error
}

var _ ExternalResourceRegistry = (*repositories.ExternalResourceRepository)(nil)

// DesignReader is the slice of the design store the ResourceService reads:
// the project's authored design components, whose platform-resource entries
// carry the ClusterResourceType to provision. It deliberately returns ONLY
// models-typed data — NOT artifacts.DesignFile — so this package keeps its
// empty arch-allowlist row (no dependencies/resources → artifacts feature
// edge). The composition root adapts artifacts.ArtifactStore.ReadDesign with
// a one-line wrapper returning design.Components ((nil, nil) design ⇒ nil
// components — "no design yet").
type DesignReader interface {
	ReadDesignComponents(ctx context.Context, orgID, projectID string) ([]models.DesignComponent, error)
}
