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
	"fmt"
	"log/slog"
	"strings"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// RequestAccess records a consumer's request to consume a cross-project
// org-service and ensures a provider-side aep:provision org-publish gate issue
// exists (deduped: a second consumer of the same provider component rides the
// existing issue). It re-keys upstream's ProviderTaskID (a component_tasks row)
// to the provider org-publish ISSUE (dependency-management §3.2 item 5). The
// functional gate is Phase 5's proceed-gate over the live catalog; this row is
// the tracking chip + the provider-side publish nudge.
func (s *Service) RequestAccess(ctx context.Context, orgID, consumerProjectID, consumerComponent, orgServiceName string) (*models.AccessRequest, error) {
	if s.access == nil || s.providers == nil {
		return nil, ErrOrgServiceNotFound
	}
	// (a) the addressed dependency must be an org-service on the consumer design.
	if _, err := s.findDepInProject(ctx, orgID, consumerProjectID, orgServiceName, models.DependencyKindOrgService); err != nil {
		return nil, err
	}
	// (b) resolve the provider (at any visibility — the point is to request a
	// not-yet-published one).
	target, ok, err := s.providers.FindByComponent(ctx, orgID, orgServiceName)
	if err != nil {
		return nil, fmt.Errorf("provisioning: resolve org-service %q: %w", orgServiceName, err)
	}
	if !ok {
		return nil, ErrOrgServiceNotFound
	}
	providerProject := target.Project
	providerComponent := logicalComponent(target.Project, target.Component)

	// (c) idempotency: an open request/issue for this provider component → the new
	// consumer rides the same provider issue.
	open, err := s.access.FindOpenForTarget(ctx, orgID, providerProject, providerComponent)
	if err != nil {
		return nil, fmt.Errorf("provisioning: find open access request: %w", err)
	}

	ar := &models.AccessRequest{
		OrgID:                 orgID,
		ConsumerProjectID:     consumerProjectID,
		ConsumerComponentName: consumerComponent,
		OrgServiceName:        orgServiceName,
		ProviderProjectID:     providerProject,
		ProviderComponentName: providerComponent,
		Status:                models.AccessRequestStatusRequested,
	}
	if open != nil {
		ar.ProviderTaskID = open.ProviderTaskID
		ar.ProviderIssueNumber = open.ProviderIssueNumber
		ar.ProviderIssueURL = open.ProviderIssueURL
	} else {
		// (d) create the provider-side org-publish gate issue.
		issue, cerr := s.createOrgPublishIssue(ctx, orgID, providerProject, providerComponent, orgServiceName)
		if cerr != nil {
			return nil, cerr
		}
		ar.ProviderIssueNumber = issue.Number
		ar.ProviderIssueURL = issue.URL
		ar.ProviderTaskID = providerTaskKey(providerProject, issue.Number)
	}
	if err := s.access.Create(ctx, ar); err != nil {
		return nil, fmt.Errorf("provisioning: create access request: %w", err)
	}
	return ar, nil
}

// ListAccessRequests returns a consumer project's access requests (newest first
// is the repository's concern).
func (s *Service) ListAccessRequests(ctx context.Context, orgID, consumerProjectID string) ([]models.AccessRequest, error) {
	if s.access == nil {
		return nil, nil
	}
	return s.access.ListByConsumerProject(ctx, orgID, consumerProjectID)
}

// OnComponentDeployed is the deploy-observer entry point (codingagent.DeployObserver):
// a component just deployed, so grant any pending cross-project access request
// targeting it. Delegates to GrantByProviderComponent.
func (s *Service) OnComponentDeployed(ctx context.Context, orgID, projectID, component string) error {
	return s.GrantByProviderComponent(ctx, orgID, projectID, component)
}

// GrantByProviderComponent is the deploy-cascade hook: when a provider component
// deploys, any open access request targeting it flips to granted and its
// org-publish issue closes. Best-effort; only the gating read returns an error.
// (The durability marker — committing exposesAPI.orgPublished on the provider
// design — needs the single-file committed-truth write path and is tracked as a
// follow-up; the functional resume is the provider going namespace-visible, which
// Phase 5's proceed-gate observes over the live catalog.)
func (s *Service) GrantByProviderComponent(ctx context.Context, orgID, providerProjectID, providerComponent string) error {
	if s.access == nil {
		return nil
	}
	open, err := s.access.FindOpenForTarget(ctx, orgID, providerProjectID, providerComponent)
	if err != nil {
		return fmt.Errorf("provisioning: find open access request: %w", err)
	}
	if open == nil {
		return nil // a normal deploy with no pending cross-project access request
	}
	rows, err := s.access.ListByProviderTask(ctx, open.ProviderTaskID)
	if err != nil {
		slog.WarnContext(ctx, "provisioning: list riders for grant failed", "providerTask", open.ProviderTaskID, "error", err)
		rows = []models.AccessRequest{*open}
	}
	for i := range rows {
		if rows[i].Status == models.AccessRequestStatusGranted {
			continue
		}
		if uerr := s.access.UpdateStatus(ctx, rows[i].ID, models.AccessRequestStatusGranted); uerr != nil {
			slog.WarnContext(ctx, "provisioning: grant access request failed", "id", rows[i].ID, "error", uerr)
		}
	}
	if open.ProviderIssueNumber > 0 {
		comment := fmt.Sprintf("Published %s org-wide (namespace visibility). Closing — consumers will resume automatically.", providerComponent)
		if cerr := s.issues.CloseIssue(ctx, orgID, providerProjectID, open.ProviderIssueNumber, comment); cerr != nil {
			slog.WarnContext(ctx, "provisioning: close org-publish issue failed", "issue", open.ProviderIssueNumber, "error", cerr)
		}
	}
	return nil
}

// RejectByProviderTask flips every still-open rider on a provider org-publish
// issue to rejected — the provider declined to publish.
func (s *Service) RejectByProviderTask(ctx context.Context, providerTaskID string) error {
	if s.access == nil {
		return nil
	}
	rows, err := s.access.ListByProviderTask(ctx, providerTaskID)
	if err != nil {
		return fmt.Errorf("provisioning: list riders for reject: %w", err)
	}
	for i := range rows {
		if rows[i].Status == models.AccessRequestStatusGranted || rows[i].Status == models.AccessRequestStatusRejected {
			continue
		}
		if uerr := s.access.UpdateStatus(ctx, rows[i].ID, models.AccessRequestStatusRejected); uerr != nil {
			slog.WarnContext(ctx, "provisioning: reject access request failed", "id", rows[i].ID, "error", uerr)
		}
	}
	return nil
}

// createOrgPublishIssue mints the provider-side aep:provision org-publish gate
// issue. It carries no secrets — only the component name being published.
func (s *Service) createOrgPublishIssue(ctx context.Context, orgID, providerProjectID, providerComponent, orgServiceName string) (*gitrepo.IssueResult, error) {
	title := fmt.Sprintf("Publish %s org-wide: add namespace visibility", providerComponent)
	block := taskmeta.Block{
		Component: providerComponent,
		GateKind:  taskmeta.GateOrgPublish,
		Origin:    taskmeta.OriginManual,
	}
	body := taskmeta.ComposeBody(block, taskmeta.Human{
		Rationale: fmt.Sprintf("Another project requested access to `%s`.", orgServiceName),
		Body: fmt.Sprintf("## Publish `%s` org-wide\n\nA consumer project depends on this component as an "+
			"org-service. Publish it (set `exposesAPI.orgPublished` + redeploy with namespace visibility) so the "+
			"consumer can resolve it. The platform closes this issue and grants the request once the component is "+
			"published.", providerComponent),
	})
	issue, err := s.issues.CreateIssue(ctx, orgID, providerProjectID, gitrepo.CreateIssueRequest{
		Title:  title,
		Body:   body,
		Labels: taskmeta.NewTaskLabels(taskmeta.ClassProvision, taskmeta.OriginManual),
	})
	if err != nil {
		return nil, fmt.Errorf("provisioning: create org-publish issue: %w", err)
	}
	return issue, nil
}

// logicalComponent strips the `<project>-` prefix an OC component name carries,
// yielding the design's logical component name.
func logicalComponent(project, ocComponent string) string {
	return strings.TrimPrefix(ocComponent, project+"-")
}

// providerTaskKey is the stable ProviderTaskID re-keyed to the provider issue
// (was a component_tasks row id upstream): "<providerProject>#<issueNumber>".
func providerTaskKey(providerProjectID string, issueNumber int) string {
	return fmt.Sprintf("%s#%d", providerProjectID, issueNumber)
}
