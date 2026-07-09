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
	"strings"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/files"
	"github.com/wso2/aep/aep-api/internal/feature/validation"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// validationCriteriaPath is the acceptance-oracle file the validation minter
// reads (kept in sync with validation.criteriaFilePath, which is unexported).
const validationCriteriaPath = "specs/validation/validation-criteria.json"

// validationCriteria adapts the Files API to validation's CriteriaReader port:
// it reads specs/validation/validation-criteria.json at HEAD, reporting a file
// absent at HEAD as found=false with no error (the design agent has not authored
// the oracle yet). Keeps the files feature out of the validation package.
type validationCriteria struct {
	files files.FilesService
}

func (a validationCriteria) ReadValidationCriteria(ctx context.Context, orgID, projectID string) (raw []byte, found bool, err error) {
	fc, rerr := a.files.Read(ctx, orgID, projectID, validationCriteriaPath)
	if rerr != nil {
		if errors.Is(rerr, files.ErrFileNotFound) {
			return nil, false, nil
		}
		return nil, false, rerr
	}
	return []byte(fc.Content), true, nil
}

// validationExecLocator adapts the executions repository to validation's
// ExecutionLocator port: it resolves a runner's execution id to its project,
// org-fenced (GetByIDScoped returns nil for a different org — the tenant fence).
type validationExecLocator struct {
	repo repositories.ExecutionRepository
}

func (l validationExecLocator) LookupExecutionProject(ctx context.Context, orgHandle, executionID string) (string, bool, error) {
	row, err := l.repo.GetByIDScoped(ctx, orgHandle, executionID)
	if err != nil {
		return "", false, err
	}
	if row == nil {
		return "", false, nil
	}
	return row.ProjectID, true, nil
}

// componentDeployLister is the ListDeployments slice of ComponentService the
// endpoint resolver needs (satisfied structurally by *component.componentService).
type componentDeployLister interface {
	ListDeployments(ctx context.Context, orgName, projectName, componentName string) (*models.DeploymentList, error)
}

// validationEndpointResolver adapts the design read + ComponentService to
// validation's EndpointResolver port: the deployed external URL (first HTTP
// external endpoint from the OpenChoreo ReleaseBinding) per design component. A
// component with no resolved URL yet is skipped (best-effort).
type validationEndpointResolver struct {
	store *artifacts.ArtifactStore
	comp  componentDeployLister
}

func (r validationEndpointResolver) ResolveEndpoints(ctx context.Context, orgHandle, projectID string) ([]validation.ComponentEndpoint, error) {
	df, err := r.store.ReadDesign(ctx, orgHandle, projectID)
	if err != nil {
		return nil, err
	}
	var out []validation.ComponentEndpoint
	for i := range df.Components {
		name := df.Components[i].Name
		list, lerr := r.comp.ListDeployments(ctx, orgHandle, projectID, name)
		if lerr != nil {
			continue // not deployed / not resolvable yet — skip
		}
		if url := firstDeploymentURL(list); url != "" {
			out = append(out, validation.ComponentEndpoint{Component: name, URL: url})
		}
	}
	return out, nil
}

// firstDeploymentURL returns the first non-empty deployed endpoint URL.
func firstDeploymentURL(list *models.DeploymentList) string {
	if list == nil {
		return ""
	}
	for i := range list.Items {
		if u := list.Items[i].EndpointURL; u != "" {
			return u
		}
	}
	return ""
}

// devflowValidator is the dev workflow's post-execution consistency check
// (the Validate activity): every design component must have a Ready deployment
// (a reachable external URL). It is the author's intended check for the
// validating phase, implemented — an independent OpenChoreo verification of
// what the task outcomes already imply.
type devflowValidator struct {
	store *artifacts.ArtifactStore
	comp  componentDeployLister
}

func (v devflowValidator) Validate(ctx context.Context, orgID, projectID, _ string) error {
	df, err := v.store.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("validate: read design: %w", err)
	}
	var undeployed []string
	for i := range df.Components {
		name := df.Components[i].Name
		list, lerr := v.comp.ListDeployments(ctx, orgID, projectID, name)
		if lerr != nil || firstDeploymentURL(list) == "" {
			undeployed = append(undeployed, name)
		}
	}
	if len(undeployed) > 0 {
		return fmt.Errorf("components without a ready deployment: %s", strings.Join(undeployed, ", "))
	}
	return nil
}

// devflowValidationResolver adapts the validation service onto the devflow
// ValidationResolver port: ensure the project's validation issue exists
// (idempotent) and return its number (0 = no acceptance criteria). The design
// tag is resolved here so the devflow package stays free of the artifacts +
// validation features.
type devflowValidationResolver struct {
	svc *validation.Service
	art artifacts.ArtifactService
}

func (r devflowValidationResolver) ResolveValidationTask(ctx context.Context, orgID, projectID string) (int, error) {
	designTag := r.art.LatestDesignTag(ctx, orgID, projectID)
	return r.svc.ResolveValidationTask(ctx, orgID, projectID, designTag)
}
