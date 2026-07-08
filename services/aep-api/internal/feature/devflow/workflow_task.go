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
	"time"

	"github.com/wso2/aep/aep-api/models"
	"go.temporal.io/sdk/workflow"
)

// QueryStatus is the query name both workflows expose so the API/console can
// read live workflow state.
const QueryStatus = "status"

// TaskFlowInput starts a per-Task workflow: dispatch the coding agent, wait
// for the PR, merge, build, deploy. Repo is "owner/name"; Issue is the task's
// GitHub issue number.
type TaskFlowInput struct {
	OrgID            string     `json:"orgId"`
	ProjectID        string     `json:"projectId"`
	Repo             string     `json:"repo"`
	Issue            int        `json:"issue"`
	Tag              string     `json:"tag"`
	ParentWorkflowID string     `json:"parentWorkflowId,omitempty"`
	Gates            GateConfig `json:"gates"`
}

// TaskFlowStatus is the QueryStatus result for a task workflow.
type TaskFlowStatus struct {
	Phase       string `json:"phase"`
	Issue       int    `json:"issue"`
	ExecutionID string `json:"executionId,omitempty"`
	PRNumber    int    `json:"prNumber,omitempty"`
	PendingGate string `json:"pendingGate,omitempty"`
	Error       string `json:"error,omitempty"`
}

// TaskFlowResult is what the workflow returns to its parent.
type TaskFlowResult struct {
	Issue   int    `json:"issue"`
	Outcome string `json:"outcome"` // succeeded | failed | skipped-dep-failed
	Error   string `json:"error,omitempty"`
}

// TaskFlow phase values.
const (
	TaskPhaseStarting  = "starting"
	TaskPhaseCoding    = "coding"
	TaskPhaseMerging   = "merging"
	TaskPhaseBuilding  = "building"
	TaskPhaseDeploying = "deploying"
	TaskPhaseDone      = "done"
	TaskPhaseFailed    = "failed"
)

// TaskFlowWorkflow is the per-Task lifecycle. This is the Phase 1 skeleton: it
// records the run in the lookup index and exposes the status query. Phases 2/4
// fill in the dispatch → PR → merge → build → deploy signal sequence and the
// gate pauses.
func TaskFlowWorkflow(ctx workflow.Context, in TaskFlowInput) (TaskFlowResult, error) {
	status := TaskFlowStatus{Phase: TaskPhaseStarting, Issue: in.Issue}
	if err := workflow.SetQueryHandler(ctx, QueryStatus, func() (TaskFlowStatus, error) {
		return status, nil
	}); err != nil {
		return TaskFlowResult{Issue: in.Issue, Outcome: "failed", Error: err.Error()}, err
	}

	info := workflow.GetInfo(ctx)
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).RecordWorkflowRun, RecordWorkflowRunInput{
		WorkflowID:       info.WorkflowExecution.ID,
		RunID:            info.WorkflowExecution.RunID,
		Kind:             models.WorkflowKindTask,
		OrgID:            in.OrgID,
		ProjectID:        in.ProjectID,
		Tag:              in.Tag,
		Repo:             in.Repo,
		IssueNumber:      in.Issue,
		ParentWorkflowID: in.ParentWorkflowID,
	}).Get(ctx, nil); err != nil {
		return TaskFlowResult{Issue: in.Issue, Outcome: "failed", Error: err.Error()}, err
	}

	// Phase 1 skeleton: no work yet. Mark done + terminal in the index.
	status.Phase = TaskPhaseDone
	_ = workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).SetWorkflowRunStatus, SetWorkflowRunStatusInput{
		WorkflowID: info.WorkflowExecution.ID,
		Status:     models.WorkflowStatusCompleted,
	}).Get(ctx, nil)

	return TaskFlowResult{Issue: in.Issue, Outcome: "succeeded"}, nil
}

// withDefaultActivityOpts returns a context carrying the default activity
// options for short adapter activities (2m start-to-close, 3 retries).
func withDefaultActivityOpts(ctx workflow.Context) workflow.Context {
	return workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
	})
}
