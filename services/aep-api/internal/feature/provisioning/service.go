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
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/models"
)

// defaultEnv is the single environment provisioning pins in v1 — the watcher and
// the declarative-wiring comment both read the `development` binding (upstream
// parity: the two naming schemes are deliberately identical).
const defaultEnv = "development"

// Service coordinates dependency provisioning on the aep:provision funnel: it
// mints gate issues, collects external values, provisions platform resources,
// tracks cross-project access requests, and drives each provision Execution
// through the store while closing the gate issue with a no-secrets reference.
type Service struct {
	issues    IssueClient
	execs     ExecutionStore
	reeval    Reevaluator
	design    DesignReader
	repos     RepoLocator
	catalog   ExternalResourceCatalog
	extProv   ExternalProvisioner
	platProv  PlatformProvisioner
	bindings  BindingReader
	projects  ProjectLister
	access    AccessStore
	providers ProviderResolver
}

// Deps is the provisioning service's collaborator set. reeval / projects /
// access / providers may be nil (a nil reeval skips the release nudge — the
// sweep heals it; a nil projects skips the cross-project consumer scan; nil
// access / providers disable the access-request surface).
type Deps struct {
	Issues    IssueClient
	Execs     ExecutionStore
	Reeval    Reevaluator
	Design    DesignReader
	Repos     RepoLocator
	Catalog   ExternalResourceCatalog
	ExtProv   ExternalProvisioner
	PlatProv  PlatformProvisioner
	Bindings  BindingReader
	Projects  ProjectLister
	Access    AccessStore
	Providers ProviderResolver
}

// NewService wires the provisioning service from its collaborator set.
func NewService(d Deps) *Service {
	return &Service{
		issues:    d.Issues,
		execs:     d.Execs,
		reeval:    d.Reeval,
		design:    d.Design,
		repos:     d.Repos,
		catalog:   d.Catalog,
		extProv:   d.ExtProv,
		platProv:  d.PlatProv,
		bindings:  d.Bindings,
		projects:  d.Projects,
		access:    d.Access,
		providers: d.Providers,
	}
}

// findDepInProject locates a dependency of a given name + kind anywhere in the
// project's design at HEAD (external resources and platform resources are
// project-level — a gate issue and its values/params are keyed by dependency
// name, not by the consuming component). Returns ErrDepNotFound when no
// dependency of that name exists and ErrDepWrongKind when it exists as another
// kind.
func (s *Service) findDepInProject(ctx context.Context, orgID, projectID, depName, kind string) (*models.Dependency, error) {
	comps, err := s.design.ReadDesignComponents(ctx, orgID, projectID)
	if err != nil {
		return nil, fmt.Errorf("provisioning: read design: %w", err)
	}
	var wrongKind bool
	for i := range comps {
		for j := range comps[i].Dependencies {
			d := &comps[i].Dependencies[j]
			if !strings.EqualFold(d.Name, depName) {
				continue
			}
			if d.Kind != kind {
				wrongKind = true
				continue
			}
			return d, nil
		}
	}
	if wrongKind {
		return nil, resources.ErrDepWrongKind
	}
	return nil, resources.ErrDepNotFound
}

// findProvisionIssue returns the open aep:provision gate issue for a dependency
// name (its block Component), or found=false when none exists yet.
func (s *Service) findProvisionIssue(ctx context.Context, orgID, projectID, depName string) (number int, found bool, err error) {
	issues, err := s.issues.ListIssues(ctx, orgID, projectID, []string{taskmeta.LabelMarker})
	if err != nil {
		return 0, false, fmt.Errorf("provisioning: list issues: %w", err)
	}
	want := strings.ToLower(depName)
	for _, issue := range issues {
		if !strings.EqualFold(issue.State, "open") {
			continue
		}
		labels := taskmeta.ParseLabels(issue.Labels)
		if labels.Class != taskmeta.ClassProvision {
			continue
		}
		block, berr := taskmeta.ParseBlock(issue.Body)
		if berr != nil {
			continue
		}
		if strings.ToLower(block.Component) == want {
			return issue.Number, true, nil
		}
	}
	return 0, false, nil
}

// admitProvisionRow admits a provision Execution for a gate issue. The row's
// Repo MUST be the issue's repo full name so the funnel gate's
// LatestPerKind(repo, issue) resolves it. Returns (nil, false) when a provision
// run is already active for this gate (the mutex lost the race) — an idempotent
// re-provision.
func (s *Service) admitProvisionRow(ctx context.Context, orgID, projectID, repo, depName string, issueNumber int) (row *models.Execution, admitted bool, err error) {
	admitted, row, err = s.execs.TryAdmit(ctx, &models.Execution{
		OrgID:       orgID,
		ProjectID:   projectID,
		Repo:        repo,
		IssueNumber: issueNumber,
		Kind:        string(taskmeta.KindProvision),
		Status:      string(taskmeta.ExecQueued),
		Component:   depName,
	})
	return row, admitted, err
}

// completeProvisionRow finishes a provision Execution succeeded, closes the gate
// issue with a no-secrets reference, and re-evaluates the funnel so consumer
// tasks gated on this dependency dispatch. Used by the synchronous external path
// and the readiness watcher.
func (s *Service) completeProvisionRow(ctx context.Context, orgID, projectID string, issueNumber int, execID, reference string) {
	if _, err := s.execs.Finish(ctx, execID, string(taskmeta.ExecSucceeded), reference); err != nil {
		slog.WarnContext(ctx, "provisioning: finish provision run failed", "execution", execID, "error", err)
		return
	}
	comment := "✅ Provisioned. " + reference + "\n\nClosing — dependent tasks will dispatch automatically."
	if err := s.issues.CloseIssue(ctx, orgID, projectID, issueNumber, comment); err != nil {
		slog.WarnContext(ctx, "provisioning: close gate issue failed", "issue", issueNumber, "error", err)
	}
	if s.reeval != nil {
		if err := s.reeval.Reevaluate(ctx); err != nil {
			slog.WarnContext(ctx, "provisioning: reevaluate after provision failed", "error", err)
		}
	}
}

// failProvisionRow finishes a provision Execution failed and comments the gate
// issue (kept open for retry). The reason carries no secret values.
func (s *Service) failProvisionRow(ctx context.Context, orgID, projectID string, issueNumber int, execID, reason string) {
	if _, err := s.execs.Finish(ctx, execID, string(taskmeta.ExecFailed), reason); err != nil {
		slog.WarnContext(ctx, "provisioning: finish provision run (failed) failed", "execution", execID, "error", err)
	}
	if issueNumber > 0 {
		if err := s.issues.CommentIssue(ctx, orgID, projectID, issueNumber, "⚠️ Provisioning failed: "+reason); err != nil {
			slog.WarnContext(ctx, "provisioning: comment gate issue failed", "issue", issueNumber, "error", err)
		}
	}
}

// envList returns the environments to provision, defaulting to [development].
func envList(reqEnvs []string) []string {
	out := make([]string, 0, len(reqEnvs))
	for _, e := range reqEnvs {
		if e = strings.TrimSpace(e); e != "" {
			out = append(out, e)
		}
	}
	if len(out) == 0 {
		return []string{defaultEnv}
	}
	return out
}
