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
	OrgID     string `json:"orgId"`
	ProjectID string `json:"projectId"`
	Repo      string `json:"repo"`
	Issue     int    `json:"issue"`
	Tag       string `json:"tag"`
	// Class discriminates the task lifecycle. Empty (default) is a coding task:
	// coding → merge → build → deploy. TaskClassValidation ends at merge — the
	// validation task produces a PR (committed e2e tests + report) but no
	// component build/deploy (validation-phase).
	Class            string     `json:"class,omitempty"`
	ParentWorkflowID string     `json:"parentWorkflowId,omitempty"`
	Gates            GateConfig `json:"gates"`
}

// TaskClassValidation is the TaskFlowInput.Class value for the project's
// validation task. It dispatches like a coding task (the funnel resolves the
// Playwright runner from the issue's aep:validation label) but ends at merge.
const TaskClassValidation = "validation"

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

// Signal-wait deadlines. Generous — a stuck run surfaces via the status query
// rather than a silent hang; the workflow run timeout is the final backstop.
const (
	codingWaitTimeout = 2 * time.Hour
	mergeWaitTimeout  = 30 * time.Minute
	buildWaitTimeout  = 30 * time.Minute
	deployWaitTimeout = 15 * time.Minute
)

// Outcome values for TaskFlowResult.
const (
	OutcomeSucceeded     = "succeeded"
	OutcomeFailed        = "failed"
	OutcomeSkippedDepFai = "skipped-dep-failed"
)

// TaskFlowWorkflow is the per-Task lifecycle: dispatch the coding agent, wait
// for the PR, merge (auto or human-gated), wait for the build, wait for the
// deploy, then report to the parent. Every wait is driven by a signal the
// existing webhook handlers / watchers emit (see signaler.go), not polling.
func TaskFlowWorkflow(ctx workflow.Context, in TaskFlowInput) (TaskFlowResult, error) {
	status := TaskFlowStatus{Phase: TaskPhaseStarting, Issue: in.Issue}
	if err := workflow.SetQueryHandler(ctx, QueryStatus, func() (TaskFlowStatus, error) {
		return status, nil
	}); err != nil {
		return TaskFlowResult{Issue: in.Issue, Outcome: OutcomeFailed, Error: err.Error()}, err
	}
	gates := newGateKeeper(in.Gates, func(g string) { status.PendingGate = g })
	info := workflow.GetInfo(ctx)

	fail := func(msg string) (TaskFlowResult, error) {
		status.Phase, status.Error = TaskPhaseFailed, msg
		markRunStatus(ctx, info.WorkflowExecution.ID, models.WorkflowStatusFailed)
		return TaskFlowResult{Issue: in.Issue, Outcome: OutcomeFailed, Error: msg}, nil
	}

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
		return fail("record workflow run: " + err.Error())
	}

	// Gate: start coding (auto by default).
	if ok, d := gates.await(ctx, GateStartCoding); !ok {
		return fail("start-coding gate rejected: " + d.Note)
	}

	// Dispatch the coding agent through the funnel.
	status.Phase = TaskPhaseCoding
	var executionID string
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).DispatchCoding, DispatchCodingInput{
		OrgID: in.OrgID, ProjectID: in.ProjectID, Repo: in.Repo, Issue: in.Issue,
	}).Get(ctx, &executionID); err != nil {
		return fail("dispatch coding: " + err.Error())
	}
	status.ExecutionID = executionID

	// Wait for the coding attempt to end: pr-opened (success) or job-status
	// failed. The coding agent's success IS the PR opening (§7).
	prOpened := workflow.GetSignalChannel(ctx, SigPROpened)
	jobStatus := workflow.GetSignalChannel(ctx, SigJobStatus)
	var pr PRSignal
	{
		var jobFailed *RunStatusSignal
		timer := workflow.NewTimer(ctx, codingWaitTimeout)
		done := false
		for !done {
			sel := workflow.NewSelector(ctx)
			sel.AddReceive(prOpened, func(c workflow.ReceiveChannel, _ bool) {
				c.Receive(ctx, &pr)
				done = true
			})
			sel.AddReceive(jobStatus, func(c workflow.ReceiveChannel, _ bool) {
				var s RunStatusSignal
				c.Receive(ctx, &s)
				if s.Phase == PhaseFailed {
					jobFailed = &s
					done = true
				}
			})
			sel.AddFuture(timer, func(workflow.Future) { done = true })
			sel.Select(ctx)
		}
		if jobFailed != nil {
			return fail("coding job failed: " + jobFailed.Message)
		}
		if pr.PRNumber == 0 {
			return fail("timed out waiting for the pull request")
		}
	}
	status.PRNumber = pr.PRNumber

	// Merge phase (gate merge-pr). Auto → platform squash-merges. Manual →
	// wait for an approve decision (then merge) OR an external human merge
	// (pr-merged); a reject or pr-rejected fails the task.
	status.Phase = TaskPhaseMerging
	prMerged := workflow.GetSignalChannel(ctx, SigPRMerged)
	prRejected := workflow.GetSignalChannel(ctx, SigPRRejected)
	merged := false
	if in.Gates.IsAuto(GateMergePR) {
		if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).MergePR, MergePRInput{
			OrgID: in.OrgID, ProjectID: in.ProjectID, PRNumber: pr.PRNumber,
		}).Get(ctx, nil); err != nil {
			return fail("merge pr: " + err.Error())
		}
	} else {
		status.PendingGate = GateMergePR
		gateCh := workflow.GetSignalChannel(ctx, SigGateDecision)
		timer := workflow.NewTimer(ctx, mergeWaitTimeout)
		decided := false
		for !decided {
			sel := workflow.NewSelector(ctx)
			sel.AddReceive(gateCh, func(c workflow.ReceiveChannel, _ bool) {
				var d GateDecisionSignal
				c.Receive(ctx, &d)
				if d.Gate != GateMergePR {
					return
				}
				decided = true
				if !d.Approve {
					status.Error = "merge-pr gate rejected: " + d.Note
					return
				}
				if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).MergePR, MergePRInput{
					OrgID: in.OrgID, ProjectID: in.ProjectID, PRNumber: pr.PRNumber,
				}).Get(ctx, nil); err != nil {
					status.Error = "merge pr: " + err.Error()
				}
			})
			sel.AddReceive(prMerged, func(c workflow.ReceiveChannel, _ bool) {
				var m PRSignal
				c.Receive(ctx, &m)
				merged, decided = true, true // human merged on GitHub
			})
			sel.AddReceive(prRejected, func(c workflow.ReceiveChannel, _ bool) {
				var r PRSignal
				c.Receive(ctx, &r)
				decided = true
				status.Error = "pull request closed without merging"
			})
			sel.AddFuture(timer, func(workflow.Future) {
				decided = true
				status.Error = "timed out waiting for merge approval"
			})
			sel.Select(ctx)
		}
		status.PendingGate = ""
		if status.Error != "" {
			return fail(status.Error)
		}
	}

	// Await the merge webhook confirmation (unless a human merge already
	// arrived above). pr-rejected here means the merge did not stick.
	if !merged {
		timer := workflow.NewTimer(ctx, mergeWaitTimeout)
		done := false
		for !done {
			sel := workflow.NewSelector(ctx)
			sel.AddReceive(prMerged, func(c workflow.ReceiveChannel, _ bool) {
				var m PRSignal
				c.Receive(ctx, &m)
				merged, done = true, true
			})
			sel.AddReceive(prRejected, func(c workflow.ReceiveChannel, _ bool) {
				var r PRSignal
				c.Receive(ctx, &r)
				done = true
			})
			sel.AddFuture(timer, func(workflow.Future) { done = true })
			sel.Select(ctx)
		}
		if !merged {
			return fail("pull request was not merged")
		}
	}

	// A validation task ends at merge: its merged PR carries the committed e2e
	// tests + report, and the runner spawns no component build/deploy (the merge
	// webhook's build-spawn is skipped for the validation class), so no
	// build/deploy signals will ever arrive. Report success to the parent.
	if in.Class == TaskClassValidation {
		status.Phase = TaskPhaseDone
		markRunStatus(ctx, info.WorkflowExecution.ID, models.WorkflowStatusCompleted)
		return TaskFlowResult{Issue: in.Issue, Outcome: OutcomeSucceeded}, nil
	}

	// Wait for the build (spawned by the merge webhook, driven by the funnel).
	status.Phase = TaskPhaseBuilding
	buildStatus := workflow.GetSignalChannel(ctx, SigBuildStatus)
	if s, ok := awaitRunStatus(ctx, buildStatus, buildWaitTimeout); !ok {
		return fail("timed out waiting for the build")
	} else if s.Phase == PhaseFailed {
		return fail("build failed: " + s.Message)
	}

	// Wait for the deploy signal.
	status.Phase = TaskPhaseDeploying
	deployStatus := workflow.GetSignalChannel(ctx, SigDeployStatus)
	if s, ok := awaitRunStatus(ctx, deployStatus, deployWaitTimeout); !ok {
		return fail("timed out waiting for the deploy")
	} else if s.Phase == PhaseFailed {
		return fail("deploy failed: " + s.Message)
	}

	status.Phase = TaskPhaseDone
	markRunStatus(ctx, info.WorkflowExecution.ID, models.WorkflowStatusCompleted)
	return TaskFlowResult{Issue: in.Issue, Outcome: OutcomeSucceeded}, nil
}

// awaitRunStatus blocks for one RunStatusSignal or the timeout. ok=false on
// timeout.
func awaitRunStatus(ctx workflow.Context, ch workflow.ReceiveChannel, timeout time.Duration) (RunStatusSignal, bool) {
	var got RunStatusSignal
	received := false
	timer := workflow.NewTimer(ctx, timeout)
	sel := workflow.NewSelector(ctx)
	sel.AddReceive(ch, func(c workflow.ReceiveChannel, _ bool) {
		c.Receive(ctx, &got)
		received = true
	})
	sel.AddFuture(timer, func(workflow.Future) {})
	sel.Select(ctx)
	return got, received
}

// markRunStatus best-effort records the run's terminal status in the lookup
// index (the workflow's own truth is Temporal; this keeps the DB index fresh
// for signalers and the list endpoint).
func markRunStatus(ctx workflow.Context, workflowID, statusStr string) {
	_ = workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).SetWorkflowRunStatus, SetWorkflowRunStatusInput{
		WorkflowID: workflowID,
		Status:     statusStr,
	}).Get(ctx, nil)
}

// withDefaultActivityOpts returns a context carrying the default activity
// options for short adapter activities (2m start-to-close per attempt; no
// explicit RetryPolicy, so the Temporal SERVER default applies — unlimited
// attempts with backoff).
func withDefaultActivityOpts(ctx workflow.Context) workflow.Context {
	return workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
	})
}
