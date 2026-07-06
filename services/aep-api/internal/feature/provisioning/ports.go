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

package provisioning

import (
	"context"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// The consumer ports the provisioning services + watcher drive. Each is the
// narrow slice of a larger collaborator; concrete providers are wired at the
// composition root. This package's feature-edge allowlist is
// {dependencies/resources, gitrepo} — everything else is a local port.

// IssueClient is the GitHub issue surface: list Task issues (to find/dedup
// aep:provision gate issues), create a gate issue, close it with a reference,
// and comment a failure. gitrepo.IssueService satisfies it.
type IssueClient interface {
	ListIssues(ctx context.Context, orgID, projectID string, labels []string) ([]gitrepo.IssueInfo, error)
	CreateIssue(ctx context.Context, orgID, projectID string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error)
	CloseIssue(ctx context.Context, orgID, projectID string, number int, comment string) error
	CommentIssue(ctx context.Context, orgID, projectID string, number int, body string) error
}

// ExecutionStore is the executions-rows repository slice the provision lifecycle
// drives: admit the provision row (the (repo, issue, kind) mutex), start it
// (queued → running, stamping the binding run name), finish it (→ deployed /
// failed), and list active rows (the readiness watcher's sweep).
// repositories.ExecutionRepository satisfies it.
type ExecutionStore interface {
	TryAdmit(ctx context.Context, e *models.Execution) (admitted bool, row *models.Execution, err error)
	StartWithRun(ctx context.Context, id, runName string) (*models.Execution, error)
	Finish(ctx context.Context, id, status, reason string) (*models.Execution, error)
	ListActive(ctx context.Context) ([]models.Execution, error)
}

// Reevaluator releases consumer coding tasks whose provision dependency just
// reached deployed (the same unhold hook build success uses). *execution.Funnel
// satisfies it.
type Reevaluator interface {
	Reevaluate(ctx context.Context) error
}

// DesignReader reads a project's authored design components at HEAD. It returns
// ONLY models-typed data so this package needs no artifacts feature edge — the
// composition root adapts artifacts.ArtifactStore. (Minting runs right after
// approval, so HEAD == the just-tagged content; the gate issue still records its
// DesignTag for lineage.)
type DesignReader interface {
	ReadDesignComponents(ctx context.Context, orgID, projectID string) ([]models.DesignComponent, error)
}

// RepoLocator resolves an org+project to its GitHub repo full name ("owner/name").
// The provision Execution row's Repo MUST match the aep:provision issue's repo
// full name, or the funnel gate's LatestPerKind(repo, issue) cannot resolve the
// run and the consumer never releases. Wired from repositories.
type RepoLocator interface {
	RepoFullName(ctx context.Context, orgID, projectID string) (string, error)
}

// ExternalResourceCatalog is the org-level external-resource registry the
// provisioning surface reads and prunes: Get (its config schema drives the
// plain/secret split at value collection), List, per-entry Consumers (the
// in-use delete guard), and the guarded Delete.
// *repositories.ExternalResourceRepository satisfies it; Get returns (nil, nil)
// when the name is not registered.
type ExternalResourceCatalog interface {
	Get(ctx context.Context, orgID, name string) (*models.ExternalResource, error)
	List(ctx context.Context, orgID string) ([]models.ExternalResource, error)
	Consumers(ctx context.Context, orgID, name string) ([]repositories.ExternalResourceConsumer, error)
	Delete(ctx context.Context, orgID, name string) error
}

// ExternalProvisioner authors the OC external Resource model + writes secrets to
// SM-API. *resources.ExternalResourceProvisioner satisfies it.
type ExternalProvisioner interface {
	Provision(ctx context.Context, orgHandle, ocOrgID, projectName string, er *models.ExternalResource, byEnv map[string]resources.EnvValues) (*resources.ProvisionResult, error)
	Deprovision(ctx context.Context, orgHandle, projectName, name string, envs []string) error
}

// PlatformProvisioner authors the OC Resource model for a platform-resource dep
// (async — returns before the binding is Ready). resources.ResourceProvisioner
// (impl *resources.OCNativeProvisioner) satisfies it.
type PlatformProvisioner = resources.ResourceProvisioner

// BindingReader reads an OC ResourceReleaseBinding for readiness + outputs.
// openchoreo.ResourceClient satisfies it.
type BindingReader interface {
	GetBinding(ctx context.Context, namespace, name string) (*openchoreo.ResourceReleaseBinding, error)
}
