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
	"errors"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/build"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/feature/design"
	"github.com/wso2/aep/aep-api/models"
)

// buildSpecTagger adapts artifacts.SaveSpec onto the build feature's
// SpecTagger port. Errors pass through unwrapped — the build handler unpacks
// *artifacts.SpecValidationError into the 422 detail.
type buildSpecTagger struct {
	art artifacts.ArtifactService
}

func (t buildSpecTagger) TagSpec(ctx context.Context, orgID, projectID string) (*artifacts.SpecSaveResult, error) {
	return t.art.SaveSpec(ctx, orgID, projectID, artifacts.SaveRequest{Message: "Build"})
}

// buildAuthDeriver adapts design's DeriveEndUserAuthAtHead onto the build
// feature's AuthDeriver port, translating design's domain sentinels into the
// build-local ones the handler maps to 409 / 503 (build cannot import design —
// arch allowlist). Everything else passes through so the handler 500s it.
type buildAuthDeriver struct {
	svc design.DesignService
}

func (d buildAuthDeriver) DeriveEndUserAuthAtHead(ctx context.Context, orgID, projectID string) error {
	err := d.svc.DeriveEndUserAuthAtHead(ctx, orgID, projectID)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, design.ErrEndUserAuthConflict):
		return fmt.Errorf("%w: %v", build.ErrEndUserAuthConflict, err)
	case errors.Is(err, design.ErrResourceCatalogUnavailable):
		return fmt.Errorf("%w: %v", build.ErrResourceCatalogUnavailable, err)
	default:
		return err
	}
}

// buildSecretStager adapts the external-resource provisioner's SM-API-only
// StageSecrets onto the build feature's SecretStager port. The dependency name
// is the registered external-resource name (registerExternalResources keys the
// catalog on dep.Name), so a name-only ExternalResource is all StageSecrets
// needs to form the per-env secret entity. orgID is unused — the SM-API write
// keys on ocOrgID.
type buildSecretStager struct {
	prov *resources.ExternalResourceProvisioner
}

func (s buildSecretStager) StageExternalSecrets(ctx context.Context, _, ocOrgID, projectID, depName string, secretsByEnv map[string]map[string]string) (map[string]string, error) {
	return s.prov.StageSecrets(ctx, ocOrgID, projectID, &models.ExternalResource{Name: depName}, secretsByEnv)
}
