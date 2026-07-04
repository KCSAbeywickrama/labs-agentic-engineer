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

package endpoints

// AccessService is the SINGLE OWNER of the cross-project access-request state
// machine (P3.5). The source split this across three entry points in two
// packages (access.RequestAccess/RejectByProviderTask + the coding-agent
// cascade's grantAccessRequests); here one service owns every transition:
//
//	requested → in_progress → granted    (GrantByProviderComponent)
//	requested → rejected                 (RejectByProviderTask)
//
// The D-phase dispatch cascade and webhook reject close-out call
// GrantByProviderComponent / RejectByProviderTask through consumer-side ports —
// they never write AccessRequest.Status directly.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// --- Sentinels (mapped to HTTP status by access_huma.go) ----------------------

var (
	// ErrOrgServiceNotFound is returned when the addressed org-service name
	// resolves to no provider component in the org endpoint catalog (the
	// `not-found` case — not requestable). Maps to 404.
	ErrOrgServiceNotFound = errors.New("org service not found in catalog")

	// ErrDepNotFound is returned when the addressed dependency (or its
	// component, or the whole design) is absent from the consumer's design.
	// Maps to 404.
	ErrDepNotFound = errors.New("dependency not found")

	// ErrDepWrongKind is returned when the addressed dependency exists but is
	// not an `org-service` — access requests apply only to that kind. Its wrap
	// message names the dep's actual kind and the applicable one. Maps to 400.
	ErrDepWrongKind = errors.New("dependency kind does not support this action")
)

// --- Consumer-side ports ------------------------------------------------------
// dependencies/endpoints carries a single feature-edge (→ gitrepo, for the pure
// issue-body builders); every other collaborator is a narrow interface here,
// wired concretely at the composition root.

// accessStore is the slice of *repositories.AccessRequestRepository the state
// machine needs: the idempotency lookup, the row insert, the consumer-side
// list, and the provider-task fan-out + status flip used by grant/reject.
type accessStore interface {
	FindOpenForTarget(ctx context.Context, orgID, providerProjectID, providerComponentName string) (*models.AccessRequest, error)
	Create(ctx context.Context, ar *models.AccessRequest) error
	ListByProviderTask(ctx context.Context, providerTaskID string) ([]models.AccessRequest, error)
	ListByConsumerProject(ctx context.Context, orgID, projectID string) ([]models.AccessRequest, error)
	UpdateStatus(ctx context.Context, id, status string) error
}

// providerCatalog resolves the provider catalog row by org-service name (== the
// provider OC component name). The in-package *Catalog satisfies it.
type providerCatalog interface {
	FindByComponent(ctx context.Context, orgHandle, name string) (openchoreo.WorkloadEndpointInfo, bool, error)
}

// designReader reads a project's authored design components. Used twice: to
// VALIDATE the addressed dependency on the consumer component (kind policy) and
// to look up the provider component's app path (best-effort). Returns ONLY
// models-typed data — NOT artifacts.DesignFile — so this package keeps its edge
// list to gitrepo only. The composition root adapts artifacts.ArtifactStore.
type designReader interface {
	ReadDesignComponents(ctx context.Context, orgID, projectID string) ([]models.DesignComponent, error)
}

// issueOps is the slice of gitrepo.IssueService the flow needs, shaped after
// its real signatures: create the provider publish issue at request time, close
// it at grant time. gitrepo.IssueService satisfies it.
type issueOps interface {
	CreateIssue(ctx context.Context, orgID, projectID string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error)
	CloseIssue(ctx context.Context, orgID, projectID string, number int, comment string) error
}

// taskCreator creates the provider's org-publish ComponentTask. It never reads
// or writes task status (only the Projector/contracts move ComponentTask.Status).
// repositories.TaskRepository satisfies it.
type taskCreator interface {
	Create(ctx context.Context, task *models.ComponentTask) error
}

// orgPublishedMarker durably persists exposesAPI.orgPublished:true on the
// provider component at grant time. Expressed with string params only (no
// artifacts import). *artifacts.ArtifactStore satisfies it.
type orgPublishedMarker interface {
	SetComponentOrgPublished(ctx context.Context, orgID, projectID, componentName string) error
}

// compile-time assertions for the ports satisfied within this module.
var (
	_ providerCatalog = (*Catalog)(nil)
	_ accessStore     = (*repositories.AccessRequestRepository)(nil)
	_ taskCreator     = (repositories.TaskRepository)(nil)
	_ issueOps        = (gitrepo.IssueService)(nil)
)

// AccessService implements the single-owner cross-project access-request flow.
type AccessService struct {
	repo    accessStore
	catalog providerCatalog
	design  designReader
	issues  issueOps
	tasks   taskCreator
	marker  orgPublishedMarker
}

// NewAccessService wires the access-request state machine. catalog resolves the
// provider row; design validates the addressed dep + reads the provider app
// path; issues + tasks create the provider publish issue/task; marker persists
// org-published durability at grant; repo persists + transitions the rows.
func NewAccessService(
	repo accessStore,
	catalog providerCatalog,
	design designReader,
	issues issueOps,
	tasks taskCreator,
	marker orgPublishedMarker,
) *AccessService {
	return &AccessService{
		repo:    repo,
		catalog: catalog,
		design:  design,
		issues:  issues,
		tasks:   tasks,
		marker:  marker,
	}
}

// RequestAccessInput is the dep-addressed request. The addressed dependency
// name IS the org-service (provider OC component) name — the source's separate
// orgServiceName body field is gone.
type RequestAccessInput struct {
	OrgHandle         string
	ConsumerProject   string
	ConsumerComponent string
	DepName           string
}

// RequestAccess validates the addressed dependency, resolves the provider, and
// creates (or dedupes onto) the provider publish task + issue, recording an
// AccessRequest row (status `requested`). Steps:
//
//	a. Validate the addressed dep on the consumer design (kind policy): unknown
//	   component/dep ⇒ ErrDepNotFound; non-org-service ⇒ ErrDepWrongKind.
//	b. Resolve the provider catalog row by org-service name (== dep name);
//	   ErrOrgServiceNotFound when absent. Derive provider project + LOGICAL
//	   component name.
//	c. Look up the provider component's app path (best-effort — the issue body
//	   degrades gracefully without it).
//	d. Idempotency: an open request/task already targeting this provider
//	   component ⇒ ride the SAME provider task/issue, insert only THIS
//	   consumer's row.
//	e. Otherwise create the provider GitHub issue + the org-publish
//	   ComponentTask, then persist the row.
func (s *AccessService) RequestAccess(ctx context.Context, in RequestAccessInput) (*models.AccessRequest, error) {
	if in.OrgHandle == "" || in.ConsumerProject == "" || in.ConsumerComponent == "" || in.DepName == "" {
		return nil, fmt.Errorf("access: orgHandle, consumerProject, consumerComponent and depName are required")
	}

	// (a) Kind policy on the addressed dependency (consumer design).
	if err := s.validateOrgServiceDep(ctx, in.OrgHandle, in.ConsumerProject, in.ConsumerComponent, in.DepName); err != nil {
		return nil, err
	}
	orgServiceName := in.DepName

	// (b) Resolve the provider row. The org-service name is the OC component
	// name (catalog key); the provider project owns the row; the provider's
	// LOGICAL component name is the OC name with the `<project>-` prefix trimmed.
	row, ok, err := s.catalog.FindByComponent(ctx, in.OrgHandle, orgServiceName)
	if err != nil {
		return nil, fmt.Errorf("access: resolve provider for %q: %w", orgServiceName, err)
	}
	if !ok {
		return nil, ErrOrgServiceNotFound
	}
	providerProject := row.Project
	providerLogicalComponent := deriveLogicalComponent(row.Project, row.Component)

	// (c) App path from the provider design (best-effort).
	appPath := s.lookupAppPath(ctx, in.OrgHandle, providerProject, providerLogicalComponent)

	// (d) Idempotency: ride an existing open provider task if one exists.
	if existing, ferr := s.repo.FindOpenForTarget(ctx, in.OrgHandle, providerProject, providerLogicalComponent); ferr != nil {
		return nil, ferr
	} else if existing != nil {
		ar := &models.AccessRequest{
			OrgID:                 in.OrgHandle,
			ConsumerProjectID:     in.ConsumerProject,
			ConsumerComponentName: in.ConsumerComponent,
			OrgServiceName:        orgServiceName,
			ProviderProjectID:     providerProject,
			ProviderComponentName: providerLogicalComponent,
			ProviderTaskID:        existing.ProviderTaskID,
			ProviderIssueNumber:   existing.ProviderIssueNumber,
			ProviderIssueURL:      existing.ProviderIssueURL,
			Status:                models.AccessRequestStatusRequested,
		}
		if cerr := s.repo.Create(ctx, ar); cerr != nil {
			return nil, cerr
		}
		slog.InfoContext(ctx, "access request deduped onto existing provider task",
			"orgService", orgServiceName, "providerTask", existing.ProviderTaskID,
			"consumer", in.ConsumerProject+"/"+in.ConsumerComponent)
		return ar, nil
	}

	// (e) Create the provider GitHub issue + the org-publish ComponentTask.
	body := gitrepo.BuildOrgPublishIssueBody(providerLogicalComponent, appPath, in.ConsumerProject)
	title := fmt.Sprintf("Publish %s org-wide: add namespace visibility", providerLogicalComponent)
	issue, err := s.issues.CreateIssue(ctx, in.OrgHandle, providerProject, gitrepo.CreateIssueRequest{
		Title:  title,
		Body:   body,
		Labels: []string{"aep", "access-request"},
	})
	if err != nil {
		return nil, fmt.Errorf("access: create provider issue on %s: %w", providerProject, err)
	}

	task := &models.ComponentTask{
		ProjectID:       providerProject,
		OrgID:           in.OrgHandle,
		Type:            models.TaskTypeOrgPublish,
		ComponentName:   providerLogicalComponent,
		Title:           title,
		Rationale:       fmt.Sprintf("Cross-project access request from %s: add namespace visibility so %s is consumable org-wide.", in.ConsumerProject, providerLogicalComponent),
		Status:          string(models.TaskStatusPending),
		LifecycleStatus: string(models.TaskLifecycleGhIssueCreated),
		ExecType:        "WORKER",
		IssueURL:        issue.URL,
		IssueNumber:     issue.Number,
		Labels:          models.StringSlice{"aep", "access-request"},
	}
	if err := s.tasks.Create(ctx, task); err != nil {
		return nil, fmt.Errorf("access: create provider publish task: %w", err)
	}

	ar := &models.AccessRequest{
		OrgID:                 in.OrgHandle,
		ConsumerProjectID:     in.ConsumerProject,
		ConsumerComponentName: in.ConsumerComponent,
		OrgServiceName:        orgServiceName,
		ProviderProjectID:     providerProject,
		ProviderComponentName: providerLogicalComponent,
		ProviderTaskID:        task.ID,
		ProviderIssueNumber:   issue.Number,
		ProviderIssueURL:      issue.URL,
		Status:                models.AccessRequestStatusRequested,
	}
	if err := s.repo.Create(ctx, ar); err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "created cross-project access request",
		"orgService", orgServiceName, "providerProject", providerProject,
		"providerComponent", providerLogicalComponent, "providerIssue", issue.URL,
		"providerTask", task.ID, "consumer", in.ConsumerProject+"/"+in.ConsumerComponent)
	return ar, nil
}

// ListByConsumerProject returns every access request a consumer project's
// components have raised, newest first — the data the console reads to render
// per-dependency request status chips.
func (s *AccessService) ListByConsumerProject(ctx context.Context, orgHandle, projectName string) ([]models.AccessRequest, error) {
	if orgHandle == "" || projectName == "" {
		return nil, fmt.Errorf("access: orgHandle and projectName are required")
	}
	return s.repo.ListByConsumerProject(ctx, orgHandle, projectName)
}

// GrantByProviderComponent is the provider-side close-out fired when an
// org-publish task lands `deployed` (D2 calls it via a port). componentName is
// the just-deployed provider component's LOGICAL name — the org-publish task's
// ComponentName (set to providerLogicalComponent at RequestAccess time, and the
// value the deploy cascade carries into OnTaskDeployed). It matches
// AccessRequest.ProviderComponentName (also the logical name) via
// FindOpenForTarget; the durability marker below additionally accepts the OC
// `<project>-<logical>` form. Steps — each isolated, none aborts the others
// (mirrors the source cascade's best-effort semantics):
//
//  1. FindOpenForTarget — is there an open request whose provider IS this
//     component? None ⇒ normal deploy, nil return.
//  2. Persist exposesAPI.orgPublished:true on the provider component (durability).
//  3. Flip EVERY request riding on the provider task → granted.
//  4. Close the provider GitHub issue (once — all riders share it).
//
// Returns an error only when the gating FindOpenForTarget read fails (so the
// caller can log it); sub-step failures are logged and swallowed.
func (s *AccessService) GrantByProviderComponent(ctx context.Context, orgID, projectID, componentName string) error {
	if s.repo == nil {
		return nil
	}

	// (1) Is this deployed component the provider target of an open request?
	open, err := s.repo.FindOpenForTarget(ctx, orgID, projectID, componentName)
	if err != nil {
		return fmt.Errorf("access grant: find open for %s/%s: %w", projectID, componentName, err)
	}
	if open == nil {
		return nil // normal deploy — no access request waiting on this component.
	}

	// (2) Durability: set exposesAPI.orgPublished:true on the provider design.
	if s.marker != nil {
		if merr := s.marker.SetComponentOrgPublished(ctx, orgID, projectID, componentName); merr != nil {
			slog.WarnContext(ctx, "access grant: persist orgPublished durability failed",
				"project", projectID, "component", componentName, "error", merr)
		}
	}

	// (3) Flip every consumer request riding on this provider task to granted.
	rows, lerr := s.repo.ListByProviderTask(ctx, open.ProviderTaskID)
	if lerr != nil {
		// Fall back to flipping just the one row we found.
		slog.WarnContext(ctx, "access grant: ListByProviderTask failed; flipping single row",
			"providerTask", open.ProviderTaskID, "error", lerr)
		rows = []models.AccessRequest{*open}
	}
	flipped := 0
	for i := range rows {
		if rows[i].Status == models.AccessRequestStatusGranted {
			continue
		}
		if uerr := s.repo.UpdateStatus(ctx, rows[i].ID, models.AccessRequestStatusGranted); uerr != nil {
			slog.WarnContext(ctx, "access grant: UpdateStatus failed",
				"accessRequest", rows[i].ID, "error", uerr)
			continue
		}
		flipped++
	}

	// (4) Close the provider GitHub issue (best-effort).
	if s.issues != nil && open.ProviderIssueNumber > 0 {
		comment := fmt.Sprintf("Published %s org-wide (namespace visibility). Closing — consumers will resume automatically.", componentName)
		if cerr := s.issues.CloseIssue(ctx, orgID, projectID, open.ProviderIssueNumber, comment); cerr != nil {
			slog.WarnContext(ctx, "access grant: CloseIssue failed",
				"project", projectID, "issue", open.ProviderIssueNumber, "error", cerr)
		}
	}

	slog.InfoContext(ctx, "access requests granted on provider deploy",
		"project", projectID, "providerComponent", componentName,
		"providerTask", open.ProviderTaskID, "granted", flipped)
	return nil
}

// RejectByProviderTask is the reject close-out: the provider's org-publish task
// was rejected (its PR closed unmerged), so every consumer AccessRequest riding
// on that provider task is flipped to `rejected`. Already-terminal rows
// (granted/rejected) are skipped — only still-open requests move. Best-effort
// per row: a single UpdateStatus failure is logged and the loop continues; the
// method returns the first error so the caller can log it (advisory — webhook
// processing must not fail on it).
func (s *AccessService) RejectByProviderTask(ctx context.Context, providerTaskID string) error {
	if providerTaskID == "" {
		return fmt.Errorf("access: providerTaskID is required")
	}
	rows, err := s.repo.ListByProviderTask(ctx, providerTaskID)
	if err != nil {
		return fmt.Errorf("access: list rejected provider task %q: %w", providerTaskID, err)
	}
	var firstErr error
	flipped := 0
	for i := range rows {
		if rows[i].Status == models.AccessRequestStatusGranted || rows[i].Status == models.AccessRequestStatusRejected {
			continue
		}
		if uerr := s.repo.UpdateStatus(ctx, rows[i].ID, models.AccessRequestStatusRejected); uerr != nil {
			slog.WarnContext(ctx, "access reject: UpdateStatus failed",
				"accessRequest", rows[i].ID, "error", uerr)
			if firstErr == nil {
				firstErr = uerr
			}
			continue
		}
		flipped++
	}
	slog.InfoContext(ctx, "access requests rejected on provider task rejection",
		"providerTask", providerTaskID, "rejected", flipped)
	return firstErr
}

// validateOrgServiceDep applies the kind policy for the dep-addressed route:
// the addressed dep must exist on the consumer component and be an
// `org-service`. Unknown component/dep ⇒ ErrDepNotFound; other kind ⇒
// ErrDepWrongKind (naming the actual + applicable kind). Mirrors the C3
// resources kind policy.
func (s *AccessService) validateOrgServiceDep(ctx context.Context, orgHandle, project, component, depName string) error {
	comps, err := s.design.ReadDesignComponents(ctx, orgHandle, project)
	if err != nil {
		return fmt.Errorf("access: read design: %w", err)
	}
	if len(comps) == 0 {
		return fmt.Errorf("%w: no design components found for project %q", ErrDepNotFound, project)
	}
	for _, comp := range comps {
		if comp.Name != component {
			continue
		}
		for _, dep := range comp.Dependencies {
			if dep.Name != depName {
				continue
			}
			if dep.Kind != models.DependencyKindOrgService {
				return fmt.Errorf("%w: dependency %q on component %q has kind %q; this action applies only to kind %q",
					ErrDepWrongKind, depName, component, dep.Kind, models.DependencyKindOrgService)
			}
			return nil
		}
		return fmt.Errorf("%w: dep %q not found on component %q", ErrDepNotFound, depName, component)
	}
	return fmt.Errorf("%w: component %q not found in design", ErrDepNotFound, component)
}

// lookupAppPath reads the provider project's design and returns the app path of
// the component matching the logical name (case-insensitive). Best-effort: on
// any error, missing reader, or a missing component it returns "" — the issue
// body degrades gracefully.
func (s *AccessService) lookupAppPath(ctx context.Context, orgHandle, providerProject, logicalComponent string) string {
	if s.design == nil {
		return ""
	}
	comps, err := s.design.ReadDesignComponents(ctx, orgHandle, providerProject)
	if err != nil {
		slog.WarnContext(ctx, "access: read provider design for app path failed",
			"providerProject", providerProject, "error", err)
		return ""
	}
	for i := range comps {
		if strings.EqualFold(comps[i].Name, logicalComponent) {
			return comps[i].AppPath
		}
	}
	return ""
}

// deriveLogicalComponent maps the provider OC component name (the catalog key,
// e.g. `hr-directory-employee-api`) to the LOGICAL component name the design +
// repo know it as (e.g. `employee-api`) by trimming the `<project>-` prefix.
// When the prefix isn't present, the OC name is returned unchanged.
func deriveLogicalComponent(project, ocComponent string) string {
	prefix := project + "-"
	if strings.HasPrefix(ocComponent, prefix) {
		return strings.TrimPrefix(ocComponent, prefix)
	}
	return ocComponent
}
