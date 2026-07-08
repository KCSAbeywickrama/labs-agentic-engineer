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
	"github.com/wso2/aep/aep-api/models"
	"go.temporal.io/sdk/workflow"
)

// DevFlowInput starts a per-version development workflow: create the version
// tag, generate design (if missing), plan tasks, fan out task workflows,
// validate. Tag is the spec version this run builds.
type DevFlowInput struct {
	OrgID     string     `json:"orgId"`
	ProjectID string     `json:"projectId"`
	Tag       string     `json:"tag"`
	Gates     GateConfig `json:"gates"`
}

// DevFlowStatus is the QueryStatus result for a dev workflow.
type DevFlowStatus struct {
	Phase       string       `json:"phase"`
	Tag         string       `json:"tag,omitempty"`
	DesignTag   string       `json:"designTag,omitempty"`
	PendingGate string       `json:"pendingGate,omitempty"`
	Tasks       []DevTaskRef `json:"tasks,omitempty"`
	Error       string       `json:"error,omitempty"`
}

// DevTaskRef is a child task's summary in the dev workflow status.
type DevTaskRef struct {
	Issue      int    `json:"issue"`
	WorkflowID string `json:"workflowId,omitempty"`
	Phase      string `json:"phase,omitempty"`
	Outcome    string `json:"outcome,omitempty"`
}

// DevFlow phase values.
const (
	DevPhaseTagging    = "tagging"
	DevPhaseDesigning  = "designing"
	DevPhasePlanning   = "planning"
	DevPhaseExecuting  = "executing"
	DevPhaseValidating = "validating"
	DevPhaseDone       = "done"
	DevPhaseFailed     = "failed"
)

// DevFlowWorkflow is the per-version development lifecycle. This is the Phase 1
// skeleton: it records the run and exposes the status query. Phase 3 fills in
// the tag → design → plan → task fan-out → validate sequence.
func DevFlowWorkflow(ctx workflow.Context, in DevFlowInput) (DevFlowStatus, error) {
	status := DevFlowStatus{Phase: DevPhaseTagging, Tag: in.Tag}
	if err := workflow.SetQueryHandler(ctx, QueryStatus, func() (DevFlowStatus, error) {
		return status, nil
	}); err != nil {
		status.Phase, status.Error = DevPhaseFailed, err.Error()
		return status, err
	}

	info := workflow.GetInfo(ctx)
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).RecordWorkflowRun, RecordWorkflowRunInput{
		WorkflowID: info.WorkflowExecution.ID,
		RunID:      info.WorkflowExecution.RunID,
		Kind:       models.WorkflowKindDev,
		OrgID:      in.OrgID,
		ProjectID:  in.ProjectID,
		Tag:        in.Tag,
	}).Get(ctx, nil); err != nil {
		status.Phase, status.Error = DevPhaseFailed, err.Error()
		return status, err
	}

	// Phase 1 skeleton: no work yet. Mark done + terminal in the index.
	status.Phase = DevPhaseDone
	_ = workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).SetWorkflowRunStatus, SetWorkflowRunStatusInput{
		WorkflowID: info.WorkflowExecution.ID,
		Status:     models.WorkflowStatusCompleted,
	}).Get(ctx, nil)

	return status, nil
}
