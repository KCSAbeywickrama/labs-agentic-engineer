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
	"errors"

	"github.com/wso2/aep/aep-api/models"
)

// errNotConfigured is returned by an activity whose adapter was not wired
// (e.g. Temporal enabled but a dependency missing). Non-retryable in effect —
// the workflow surfaces it rather than looping.
var errNotConfigured = errors.New("devflow: activity dependency not configured")

// Activities is the set of Temporal activities the devflow workflows invoke.
// Every activity is a THIN adapter over an existing aep-api service (the
// funnel, genai turns, the plan service, the issue service) plus the
// workflow_runs lookup index — no task logic is reimplemented here. Fields
// are added as later phases wire each adapter; the workflow-run index
// activities land first because both workflows record themselves on entry.
type Activities struct {
	runs       WorkflowRunStore
	dispatcher CodingDispatcher
	merger     PRMerger
}

// NewActivities wires the activity adapters. dispatcher and merger may be nil
// in narrow contexts (their activities then return a not-configured error);
// the app root wires all three.
func NewActivities(runs WorkflowRunStore, dispatcher CodingDispatcher, merger PRMerger) *Activities {
	return &Activities{runs: runs, dispatcher: dispatcher, merger: merger}
}

// RecordWorkflowRunInput is the first-activity payload every workflow emits so
// the lookup index (workflow_runs) knows the run exists and how to signal it.
type RecordWorkflowRunInput struct {
	WorkflowID       string `json:"workflowId"`
	RunID            string `json:"runId"`
	Kind             string `json:"kind"` // dev | task
	OrgID            string `json:"orgId"`
	ProjectID        string `json:"projectId"`
	Tag              string `json:"tag,omitempty"`
	Repo             string `json:"repo,omitempty"`
	IssueNumber      int    `json:"issueNumber,omitempty"`
	ParentWorkflowID string `json:"parentWorkflowId,omitempty"`
}

// RecordWorkflowRun upserts the workflow_runs row (idempotent on workflow
// retry). Called as the first activity of both workflows.
func (a *Activities) RecordWorkflowRun(ctx context.Context, in RecordWorkflowRunInput) error {
	return a.runs.Record(ctx, &models.DevflowRun{
		WorkflowID:       in.WorkflowID,
		RunID:            in.RunID,
		Kind:             in.Kind,
		OrgID:            in.OrgID,
		ProjectID:        in.ProjectID,
		Tag:              in.Tag,
		Repo:             in.Repo,
		IssueNumber:      in.IssueNumber,
		ParentWorkflowID: in.ParentWorkflowID,
		Status:           models.WorkflowStatusRunning,
	})
}

// SetWorkflowRunStatusInput marks a run terminal in the lookup index.
type SetWorkflowRunStatusInput struct {
	WorkflowID string `json:"workflowId"`
	Status     string `json:"status"` // completed | failed | canceled
}

// SetWorkflowRunStatus records a run's terminal status in the lookup index.
// Called as the final activity of both workflows.
func (a *Activities) SetWorkflowRunStatus(ctx context.Context, in SetWorkflowRunStatusInput) error {
	return a.runs.SetStatus(ctx, in.WorkflowID, in.Status)
}

// DispatchCodingInput identifies the Task to dispatch a coding attempt for.
type DispatchCodingInput struct {
	OrgID     string `json:"orgId"`
	ProjectID string `json:"projectId"`
	Repo      string `json:"repo"`
	Issue     int    `json:"issue"`
}

// DispatchCoding triggers the coding attempt through the funnel and returns
// the admitted execution id. Idempotent: a re-dispatch while a coding
// Execution is already active is a no-op in the funnel (TryAdmit loses the
// race) and returns the active row's id.
func (a *Activities) DispatchCoding(ctx context.Context, in DispatchCodingInput) (string, error) {
	if a.dispatcher == nil {
		return "", errNotConfigured
	}
	return a.dispatcher.DispatchCoding(ctx, in.OrgID, in.ProjectID, in.Repo, in.Issue)
}

// MergePRInput identifies the pull request to squash-merge.
type MergePRInput struct {
	OrgID     string `json:"orgId"`
	ProjectID string `json:"projectId"`
	PRNumber  int    `json:"prNumber"`
}

// MergePR squash-merges the Task's pull request (the auto merge-pr gate).
func (a *Activities) MergePR(ctx context.Context, in MergePRInput) error {
	if a.merger == nil {
		return errNotConfigured
	}
	return a.merger.MergePR(ctx, in.OrgID, in.ProjectID, in.PRNumber)
}
