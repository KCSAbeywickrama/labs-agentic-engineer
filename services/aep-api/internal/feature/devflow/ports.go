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
