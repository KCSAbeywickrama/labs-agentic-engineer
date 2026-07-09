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

package devflow

import (
	"context"

	"github.com/wso2/aep/aep-api/models"
)

// WorkflowRunStore is the narrow port the activities use to maintain the
// workflow_runs lookup index. Satisfied by
// repositories.WorkflowRunRepository. Kept as a devflow-local interface so
// the workflows/activities depend on a capability, not the concrete repo
// (and tests can fake it).
type WorkflowRunStore interface {
	Record(ctx context.Context, row *models.DevflowRun) error
	SetStatus(ctx context.Context, workflowID, status string) error
}

// CodingDispatcher triggers a coding attempt for a Task through the existing
// execution funnel (admission + gating + coding executor) and returns the
// admitted execution's id. Satisfied by an app-root adapter over
// execution.Funnel — devflow does not import the execution package. A
// nil dispatcher makes DispatchCoding a not-configured error.
type CodingDispatcher interface {
	DispatchCoding(ctx context.Context, orgID, projectID, repo string, issue int) (executionID string, err error)
}

// PRMerger squash-merges a Task's pull request through the existing issue
// service. Satisfied by an app-root adapter over gitrepo.IssueService.
type PRMerger interface {
	MergePR(ctx context.Context, orgID, projectID string, prNumber int) error
}

// Tagger cuts (idempotently) the requirements version tag the build is based
// on, returning the tag name (e.g. "v3"). Satisfied by an app-root adapter
// over the artifacts service; a no-change save returns the existing tag.
type Tagger interface {
	CreateVersionTag(ctx context.Context, orgID, projectID string) (tag string, err error)
}

// DesignPort adapts design generation for the dev workflow. Satisfied by an
// app-root adapter over the artifacts + genai services.
type DesignPort interface {
	// DesignExists reports whether an approved design already exists for the
	// requirements version reqTag (so the workflow skips regeneration).
	DesignExists(ctx context.Context, orgID, projectID, reqTag string) (bool, error)
	// StartDesignTurn starts the design-generate genai turn and returns its id
	// (reusing an already-active turn's id when one is running).
	StartDesignTurn(ctx context.Context, orgID, projectID string) (turnID string, err error)
	// DesignTurnOutcome reads a turn's terminal state — the workflow's fallback
	// when the design-turn-done signal is missed. done=false while running.
	DesignTurnOutcome(ctx context.Context, orgID, projectID, turnID string) (done bool, outcome string, err error)
	// ApproveDesign cuts the next design version tag (v<N>-<M>) from the
	// generated design at HEAD — the "design gate = build trigger" step
	// (ADR-0007). Planning requires an approved (tagged) design, so a
	// freshly-generated design must be approved before the plan step.
	ApproveDesign(ctx context.Context, orgID, projectID string) error
}

// Planner runs task planning and returns the planned tasks (issue number +
// component key + dependsOn). Satisfied by an app-root adapter over the plan
// service + task reads.
type Planner interface {
	RunPlan(ctx context.Context, orgID, projectID string) ([]PlannedTask, error)
}

// Validator runs the post-execution consistency check: every design component
// has a Ready deployment (a reachable endpoint). Satisfied by an app-root
// adapter over the artifacts + component services.
type Validator interface {
	Validate(ctx context.Context, orgID, projectID, tag string) error
}

// ValidationResolver ensures the project's aep:validation Task exists
// (idempotent) and returns its open issue number, or 0 when there are no
// acceptance criteria (nothing to validate). Satisfied by an app-root adapter
// over the validation service; devflow does not import the validation package.
type ValidationResolver interface {
	ResolveValidationTask(ctx context.Context, orgID, projectID string) (issue int, err error)
}
