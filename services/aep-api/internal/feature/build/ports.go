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

package build

import (
	"context"
	"errors"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/devflow"
	"github.com/wso2/aep/aep-api/internal/feature/task"
	"github.com/wso2/aep/aep-api/models"
)

// ErrTemporalUnavailable is the runner's "cannot start/observe workflows right
// now" — mapped to a 503 at the edge, BEFORE any tag is cut.
var ErrTemporalUnavailable = errors.New("temporal unavailable")

// RunStore is the workflow_runs surface the build endpoints need: the
// one-dev-run-per-project guard, the org fence for status reads, and the
// synchronous row record on start (so a GET issued right after the POST
// returns never races the workflow's own RecordWorkflowRun activity — both
// upsert the same (workflowID, runID) row). Satisfied by
// repositories.WorkflowRunRepository.
type RunStore interface {
	RunningDevByProject(ctx context.Context, orgID, projectID string) (*models.DevflowRun, error)
	GetByWorkflowID(ctx context.Context, orgID, workflowID string) (*models.DevflowRun, error)
	Record(ctx context.Context, row *models.DevflowRun) error
}

// RepoLookup resolves a project's "owner/name" repo full name. Satisfied by
// the app-root repoFullNameLookup adapter.
type RepoLookup interface {
	RepoFullName(ctx context.Context, orgID, projectID string) (string, error)
}

// SpecTagger runs the whole-spec hard gate and cuts the next `v<N>` tag
// (artifacts.SaveSpec). Implementations MUST preserve error identity — the
// handler unwraps *artifacts.SpecValidationError into the 422 detail.
type SpecTagger interface {
	TagSpec(ctx context.Context, orgID, projectID string) (*artifacts.SpecSaveResult, error)
}

// WorkflowRunner starts and observes dev workflows. The real implementation
// wraps the devflow Temporal runtime; tests fake it.
type WorkflowRunner interface {
	// Ready reports whether workflows can be started right now
	// (ErrTemporalUnavailable while the Temporal client is down) — probed
	// BEFORE the tag is cut so an unstartable build never claims a version.
	Ready() error
	// StartBuild starts the dev workflow (start-and-return) and reports the
	// accepted execution's run id.
	StartBuild(ctx context.Context, workflowID string, in devflow.DevFlowInput) (runID string, err error)
	BuildStatus(ctx context.Context, workflowID string) (devflow.DevFlowStatus, error)
}

// TaskTitles resolves issue titles for the build-status task join. Satisfied
// by *task.Reads.
type TaskTitles interface {
	List(ctx context.Context, orgID, projectID, state string) ([]task.TaskView, error)
}
