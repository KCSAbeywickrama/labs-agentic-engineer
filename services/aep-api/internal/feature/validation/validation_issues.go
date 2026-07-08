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

package validation

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// criteriaFilePath is the acceptance-oracle path in the project repo, authored
// by the validation-criteria skill and read by the runner.
const criteriaFilePath = "specs/validation/validation-criteria.json"

// validationTitle is the fixed title of the project's validation Task. Stable
// so the idempotency Key (project, designTag, "validate", title) is stable and
// the minter creates exactly one validation issue per project+designTag.
const validationTitle = "Validate the deployed system against its acceptance criteria"

// validationOperation is the machine-block Operation for a validation Task — its
// project-scoped identity (no component; Block.Target() returns it).
const validationOperation = "validate"

// Service mints the project's validation Task issue. It holds only consumer
// ports; concrete providers are wired at the composition root.
type Service struct {
	issues   IssueClient
	design   DesignReader
	criteria CriteriaReader
}

// Deps is the validation service's collaborator set.
type Deps struct {
	Issues   IssueClient
	Design   DesignReader
	Criteria CriteriaReader
}

// NewService wires the validation service from its collaborator set.
func NewService(d Deps) *Service {
	return &Service{issues: d.Issues, design: d.Design, criteria: d.Criteria}
}

// EnsureValidationIssue mints the single aep:validation Task for the project if
// the acceptance oracle exists and no open validation issue exists yet. It is
// idempotent and best-effort: called after every design tag-cut, right after
// provisioning's EnsureProvisionIssues. A missing/malformed criteria file or a
// dedup hit is a clean no-op (never fails the design save).
func (s *Service) EnsureValidationIssue(ctx context.Context, orgID, projectID, designTag string) error {
	raw, found, err := s.criteria.ReadValidationCriteria(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("validation: read criteria: %w", err)
	}
	if !found {
		// The design agent has not authored the oracle yet — a later planning
		// pass re-mints once it exists.
		return nil
	}
	doc, err := parseCriteria(raw)
	if err != nil {
		// A malformed oracle is the design agent's bug, not a reason to fail the
		// save; skip and let a corrected pass re-mint.
		slog.WarnContext(ctx, "validation: skipping mint — criteria file unusable", "project", projectID, "error", err)
		return nil
	}

	exists, err := s.hasOpenValidationIssue(ctx, orgID, projectID)
	if err != nil {
		return err
	}
	if exists {
		return nil // one validation issue per project until it terminates
	}

	comps, err := s.design.ReadDesignComponents(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("validation: read design: %w", err)
	}
	deps := componentNames(comps)

	block := taskmeta.Block{
		Operation: validationOperation,
		DependsOn: deps,
		Origin:    taskmeta.OriginSpecPlan,
		DesignTag: designTag,
	}
	block.Key = taskmeta.Key(projectID, designTag, block.Target(), validationTitle)

	body := taskmeta.ComposeBody(block, taskmeta.Human{
		Rationale: rationale(doc.summarize()),
		Body:      renderScope(doc),
	})
	// Stamp aep:execute at creation so the task dispatches autonomously: the
	// execution sweep picks the label up, admits the run, and the funnel holds it
	// on dependsOn until every component deploys (no human Execute click, unlike
	// coding tasks). The label is consumed once the run is admitted.
	labels := append(taskmeta.NewTaskLabels(taskmeta.ClassValidation, taskmeta.OriginSpecPlan), taskmeta.LabelExecute)
	req := gitrepo.CreateIssueRequest{
		Title:  validationTitle,
		Body:   body,
		Labels: labels,
	}
	if _, cerr := s.issues.CreateIssue(ctx, orgID, projectID, req); cerr != nil {
		return fmt.Errorf("validation: create issue: %w", cerr)
	}
	slog.InfoContext(ctx, "validation: minted validation issue", "project", projectID, "dependsOn", len(deps))
	return nil
}

// hasOpenValidationIssue reports whether an open aep:validation Task already
// exists for the project (dedup — mirrors provisioning's openProvisionDeps).
func (s *Service) hasOpenValidationIssue(ctx context.Context, orgID, projectID string) (bool, error) {
	issues, err := s.issues.ListIssues(ctx, orgID, projectID, []string{taskmeta.LabelMarker})
	if err != nil {
		return false, fmt.Errorf("validation: list issues: %w", err)
	}
	for _, issue := range issues {
		if !strings.EqualFold(issue.State, "open") {
			continue
		}
		if taskmeta.ParseLabels(issue.Labels).Class == taskmeta.ClassValidation {
			return true, nil
		}
	}
	return false, nil
}

// componentNames returns the design component names (the validation task's
// dependsOn set), skipping empties.
func componentNames(comps []models.DesignComponent) []string {
	out := make([]string, 0, len(comps))
	for i := range comps {
		if n := strings.TrimSpace(comps[i].Name); n != "" {
			out = append(out, n)
		}
	}
	return out
}

// rationale is the one-line blockquote summary in the issue body.
func rationale(s criteriaSummary) string {
	return fmt.Sprintf("Validate the deployed system against %d e2e, %d scenario, and %d manual acceptance criteria.",
		s.E2E, s.Scenario, s.Manual)
}

// renderScope builds the human markdown body of the validation issue — the
// consumer contract the aep-validation skill reads (acceptance oracle + test
// layout + report). Deployed endpoints and test credentials are deliberately
// absent: the runner fetches them from the secure validation-context endpoint,
// never from this public issue. Mirrors scripts/create-validation-issue.mjs
// renderBody minus the Deployed-endpoints section.
func renderScope(doc *criteriaDoc) string {
	sum := doc.summarize()
	var b strings.Builder
	w := func(lines ...string) {
		for _, l := range lines {
			b.WriteString(l)
			b.WriteByte('\n')
		}
	}

	w(
		"Validate the deployed system against its acceptance criteria: author end-to-end tests, run them against the deployed system, and open a PR containing the tests and a validation report.",
		"",
		"The deployed endpoint URLs and any test credentials are provided to the validation runner by the platform at dispatch time — they are not in this issue.",
		"",
		"## Acceptance oracle",
		fmt.Sprintf("The source of truth is `%s` in this repo. Do not edit it except to set `covered: true` on e2e criteria whose spec passes.", criteriaFilePath),
		"",
		fmt.Sprintf("- `e2e` — %d criteria (%d already covered by committed specs; run those as regression, author specs only for the rest).", sum.E2E, sum.E2ECovered),
		fmt.Sprintf("- `manual` — %d criteria: render as an unchecked human checklist in the report.", sum.Manual),
		fmt.Sprintf("- `scenario` — %d criteria: out of scope for automation in this run; list as not-yet-validated in the report.", sum.Scenario),
		"",
	)

	for _, r := range doc.Requirements {
		w(fmt.Sprintf("### %s — %s", r.ID, r.Statement), "", "| Criterion | Method | Covered | Must |", "|---|---|---|---|")
		for _, c := range r.Criteria {
			covered := "—"
			if c.Method == "e2e" {
				if c.Covered != nil && *c.Covered {
					covered = "yes"
				} else {
					covered = "no"
				}
			}
			w(fmt.Sprintf("| %s | %s | %s | %s |", c.ID, c.Method, covered, strings.ReplaceAll(c.Must, "|", "\\|")))
		}
		w("")
	}

	w(
		"Per-component design docs: `specs/design/components/<name>/design.md` (OpenAPI contract, when present, alongside as `openapi.yaml`); system overview: `specs/design/design.md`.",
		"",
		"## Test layout",
		"- Playwright package at repo root `tests/e2e/` (own `package.json`; do not touch application source under any component app path).",
		"- One spec file per criterion: `tests/e2e/specs/<AC-ID>.spec.ts`; test title MUST start with `<AC-ID>: ` — that prefix is the join key for the report.",
		"- UI criteria: browser specs (`@playwright/test`). API criteria: the built-in `request` fixture. Explore with `playwright-cli` first; never commit exploration sessions.",
		"",
		"## Report",
		"- Commit `specs/validation/report.md` (summary, per-criterion results, manual checklist, scenario not-yet-validated list) and `specs/validation/report.json`.",
		"- Set `covered: true` in the criteria file for each e2e criterion whose spec passes.",
		"- Post a summary comment on this issue when done.",
		"",
		"---",
		"Open one PR whose body includes `Closes #<this issue's number>` so the platform links it back. One PR; tests and report only.",
	)

	return strings.TrimRight(b.String(), "\n")
}
