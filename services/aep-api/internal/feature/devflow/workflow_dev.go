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
	"fmt"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/wso2/aep/aep-api/models"
)

// designTurnWaitTimeout bounds the wait for the design-generate turn to finish.
const designTurnWaitTimeout = 30 * time.Minute

// DevFlowInput starts a per-version development workflow: create the version
// tag, generate design (if missing), plan tasks, fan out task workflows,
// validate. Tag is the spec version this run builds.
type DevFlowInput struct {
	OrgID     string `json:"orgId"`
	ProjectID string `json:"projectId"`
	// Repo is the project's "owner/name" — resolved by the API before start so
	// task children can dispatch + be signaled by the webhook handlers.
	Repo  string     `json:"repo"`
	Tag   string     `json:"tag"`
	Gates GateConfig `json:"gates"`
}

// DevFlowStatus is the QueryStatus result for a dev workflow.
type DevFlowStatus struct {
	Phase       string       `json:"phase"`
	Tag         string       `json:"tag,omitempty"`
	DesignTag   string       `json:"designTag,omitempty"`
	PendingGate string       `json:"pendingGate,omitempty"`
	Tasks       []DevTaskRef `json:"tasks,omitempty"`
	// Validation is the validating phase's outcome: the validation task child
	// (Issue/WorkflowID/Phase/Outcome), or a skip note in Outcome when the
	// project has no acceptance criteria. Nil until the validating phase runs.
	Validation *DevTaskRef `json:"validation,omitempty"`
	Error      string      `json:"error,omitempty"`
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

// DevFlowWorkflow is the per-version development lifecycle: cut the version
// tag, generate the design (unless it already exists), plan the tasks, fan out
// dependency-aware task child workflows, validate, complete. Each gate can
// pause for human approval (default auto).
func DevFlowWorkflow(ctx workflow.Context, in DevFlowInput) (DevFlowStatus, error) {
	status := DevFlowStatus{Phase: DevPhaseTagging, Tag: in.Tag}
	if err := workflow.SetQueryHandler(ctx, QueryStatus, func() (DevFlowStatus, error) {
		return status, nil
	}); err != nil {
		status.Phase, status.Error = DevPhaseFailed, err.Error()
		return status, err
	}
	gates := newGateKeeper(in.Gates, func(g string) { status.PendingGate = g })
	info := workflow.GetInfo(ctx)

	fail := func(msg string) (DevFlowStatus, error) {
		status.Phase, status.Error = DevPhaseFailed, msg
		markRunStatus(ctx, info.WorkflowExecution.ID, models.WorkflowStatusFailed)
		return status, nil
	}

	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).RecordWorkflowRun, RecordWorkflowRunInput{
		WorkflowID: info.WorkflowExecution.ID,
		RunID:      info.WorkflowExecution.RunID,
		Kind:       models.WorkflowKindDev,
		OrgID:      in.OrgID,
		ProjectID:  in.ProjectID,
		Tag:        in.Tag,
	}).Get(ctx, nil); err != nil {
		return fail("record workflow run: " + err.Error())
	}

	// 1. Create the version tag (idempotent — returns the existing tag when the
	// requirements are unchanged).
	ref := ProjectRef{OrgID: in.OrgID, ProjectID: in.ProjectID}
	var reqTag string
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).CreateVersionTag, ref).Get(ctx, &reqTag); err != nil {
		return fail("create version tag: " + err.Error())
	}
	if reqTag != "" {
		status.Tag = reqTag
	} else {
		reqTag = in.Tag
	}

	// 2. Design — skip when already generated for this requirements version.
	var designExists bool
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).CheckDesignExists, DesignExistsInput{
		OrgID: in.OrgID, ProjectID: in.ProjectID, ReqTag: reqTag,
	}).Get(ctx, &designExists); err != nil {
		return fail("check design exists: " + err.Error())
	}
	if !designExists {
		if ok, d := gates.await(ctx, GateDesign); !ok {
			return fail("design gate rejected: " + d.Note)
		}
		status.Phase = DevPhaseDesigning
		if outcome, err := runDesignTurn(ctx, in); err != nil {
			return fail(err.Error())
		} else if outcome != "completed" {
			return fail("design generation did not complete: " + outcome)
		}
		// Approve (tag) the freshly generated design — the "design gate = build
		// trigger" step. Planning requires an approved design version.
		if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).ApproveDesign, ref).Get(ctx, nil); err != nil {
			return fail("approve design: " + err.Error())
		}
	}

	// 3. Plan the tasks.
	if ok, d := gates.await(ctx, GatePlan); !ok {
		return fail("plan gate rejected: " + d.Note)
	}
	status.Phase = DevPhasePlanning
	var tasks []PlannedTask
	if err := workflow.ExecuteActivity(planActivityOpts(ctx), (*Activities).RunPlan, ref).Get(ctx, &tasks); err != nil {
		return fail("run plan: " + err.Error())
	}
	if cyc := detectDepCycle(tasks); len(cyc) > 0 {
		return fail("dependency cycle detected: " + strings.Join(cyc, " → "))
	}

	// 4. Execute — dependency-aware task child workflows.
	status.Phase = DevPhaseExecuting
	scheduleTasks(ctx, in, reqTag, tasks, &status)

	// 5. Validate.
	// 5a. Quality bar: every planned task must have succeeded. A failed or
	// dependency-skipped task means the system was not fully implemented +
	// deployed, so there is nothing coherent to validate — fail fast, before
	// asking for the validate gate (a doomed run never waits for approval).
	if unmet := notSucceeded(status.Tasks); len(unmet) > 0 {
		return fail(fmt.Sprintf("validating: %d task(s) did not succeed: %s", len(unmet), strings.Join(unmet, ", ")))
	}
	// 5b. Validate gate (human pause point, auto by default).
	if ok, d := gates.await(ctx, GateValidate); !ok {
		return fail("validate gate rejected: " + d.Note)
	}
	status.Phase = DevPhaseValidating
	// 5c. Consistency check: every design component has a Ready deployment
	// (a reachable endpoint). Independent verification against OpenChoreo of
	// what the task outcomes imply.
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).Validate, ValidateInput{
		OrgID: in.OrgID, ProjectID: in.ProjectID, Tag: reqTag,
	}).Get(ctx, nil); err != nil {
		return fail("validate: " + err.Error())
	}
	// 5d. Resolve the project's validation task (idempotent ensure + find). 0 =
	// no acceptance criteria authored → nothing to validate.
	var validationIssue int
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).ResolveValidationTask, ref).Get(ctx, &validationIssue); err != nil {
		return fail("resolve validation task: " + err.Error())
	}
	// 5e. Run the validation task as a child workflow (dispatch → PR → merge;
	// no build/deploy). A mechanical failure (crash/timeout/PR rejected) fails
	// the run; a failing test suite still merges a PR + report and succeeds —
	// that verdict is the human's to read at the complete gate.
	if validationIssue > 0 {
		wid := taskWorkflowID(in.OrgID, in.ProjectID, reqTag, validationIssue)
		status.Validation = &DevTaskRef{Issue: validationIssue, WorkflowID: wid, Phase: TaskPhaseStarting}
		cctx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:        wid,
			ParentClosePolicy: enumsParentClosePolicyTerminate(),
		})
		var res TaskFlowResult
		if err := workflow.ExecuteChildWorkflow(cctx, TaskFlowWorkflow, TaskFlowInput{
			OrgID:            in.OrgID,
			ProjectID:        in.ProjectID,
			Repo:             in.Repo,
			Issue:            validationIssue,
			Tag:              reqTag,
			Class:            TaskClassValidation,
			ParentWorkflowID: info.WorkflowExecution.ID,
			Gates:            in.Gates,
		}).Get(ctx, &res); err != nil {
			status.Validation.Phase, status.Validation.Outcome = TaskPhaseFailed, OutcomeFailed
			return fail("validation run failed: " + err.Error())
		}
		status.Validation.Phase, status.Validation.Outcome = res.Phase(), res.Outcome
		if res.Outcome != OutcomeSucceeded {
			return fail("validation run did not succeed: " + res.Outcome)
		}
	} else {
		status.Validation = &DevTaskRef{Phase: DevPhaseDone, Outcome: "skipped: no acceptance criteria"}
	}

	if ok, d := gates.await(ctx, GateComplete); !ok {
		return fail("complete gate rejected: " + d.Note)
	}
	status.Phase = DevPhaseDone
	markRunStatus(ctx, info.WorkflowExecution.ID, models.WorkflowStatusCompleted)
	return status, nil
}

// runDesignTurn starts the design-generate turn and waits for its terminal
// state via the design-turn-done signal, falling back to a status poll on
// timeout. Returns the outcome ("completed" | "failed" | "timeout").
func runDesignTurn(ctx workflow.Context, in DevFlowInput) (string, error) {
	var turnID string
	if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).StartDesignTurn, ProjectRef{
		OrgID: in.OrgID, ProjectID: in.ProjectID,
	}).Get(ctx, &turnID); err != nil {
		return "", fmt.Errorf("start design turn: %w", err)
	}

	ch := workflow.GetSignalChannel(ctx, SigDesignTurnDone)
	timer := workflow.NewTimer(ctx, designTurnWaitTimeout)
	var outcome string
	done := false
	for !done {
		sel := workflow.NewSelector(ctx)
		sel.AddReceive(ch, func(c workflow.ReceiveChannel, _ bool) {
			var s DesignTurnDoneSignal
			c.Receive(ctx, &s)
			if turnID != "" && s.TurnID != turnID {
				return // a different turn — keep waiting
			}
			outcome, done = s.Outcome, true
		})
		sel.AddFuture(timer, func(workflow.Future) {
			// Signal missed? Poll the turn's terminal state once before giving up.
			var res DesignTurnOutcomeResult
			if err := workflow.ExecuteActivity(withDefaultActivityOpts(ctx), (*Activities).PollDesignTurn, DesignTurnOutcomeInput{
				OrgID: in.OrgID, ProjectID: in.ProjectID, TurnID: turnID,
			}).Get(ctx, &res); err == nil && res.Done {
				outcome = res.Outcome
			} else {
				outcome = "timeout"
			}
			done = true
		})
		sel.Select(ctx)
	}
	return outcome, nil
}

// scheduleTasks runs the planned tasks as child workflows, respecting the
// dependency graph: a task starts once all its dependencies have succeeded;
// tasks whose dependency failed are skipped. Independent tasks run in
// parallel. Deterministic — it iterates the stable task slice, never a map.
func scheduleTasks(ctx workflow.Context, in DevFlowInput, tag string, tasks []PlannedTask, status *DevFlowStatus) {
	// Seed the status task list in plan order.
	status.Tasks = make([]DevTaskRef, 0, len(tasks))
	for _, t := range tasks {
		status.Tasks = append(status.Tasks, DevTaskRef{Issue: t.Issue, Phase: "pending"})
	}

	present := map[string]bool{}
	for _, t := range tasks {
		present[strings.ToLower(t.Key)] = true
	}
	succeeded := map[string]bool{}
	failed := map[string]bool{}
	started := map[int]bool{}

	type childRun struct {
		task   PlannedTask
		future workflow.ChildWorkflowFuture
	}
	var running []childRun
	finished := 0

	for finished < len(tasks) {
		// Start every ready task (stable slice order).
		for i := range tasks {
			t := tasks[i]
			if started[t.Issue] {
				continue
			}
			if depFailed(t, failed) {
				started[t.Issue] = true
				failed[strings.ToLower(t.Key)] = true
				finished++
				setTaskRef(status, t.Issue, "", TaskPhaseFailed, OutcomeSkippedDepFai)
				continue
			}
			if !depsSatisfied(t, succeeded, present) {
				continue
			}
			wid := taskWorkflowID(in.OrgID, in.ProjectID, tag, t.Issue)
			cctx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
				WorkflowID:        wid,
				ParentClosePolicy: enumsParentClosePolicyTerminate(),
			})
			f := workflow.ExecuteChildWorkflow(cctx, TaskFlowWorkflow, TaskFlowInput{
				OrgID:            in.OrgID,
				ProjectID:        in.ProjectID,
				Repo:             in.Repo,
				Issue:            t.Issue,
				Tag:              tag,
				ParentWorkflowID: workflow.GetInfo(ctx).WorkflowExecution.ID,
				Gates:            in.Gates,
			})
			started[t.Issue] = true
			running = append(running, childRun{task: t, future: f})
			setTaskRef(status, t.Issue, wid, TaskPhaseStarting, "")
		}

		if len(running) == 0 {
			// No task is runnable and none is running — remaining are blocked by
			// failed deps (or an unresolved cycle the fast-fail missed). Skip them.
			for i := range tasks {
				t := tasks[i]
				if !started[t.Issue] {
					started[t.Issue] = true
					failed[strings.ToLower(t.Key)] = true
					finished++
					setTaskRef(status, t.Issue, "", TaskPhaseFailed, OutcomeSkippedDepFai)
				}
			}
			break
		}

		// Wait for one child to complete.
		completedIdx := -1
		sel := workflow.NewSelector(ctx)
		for idx := range running {
			i := idx
			cr := running[idx]
			sel.AddFuture(cr.future, func(f workflow.Future) {
				completedIdx = i
				var res TaskFlowResult
				key := strings.ToLower(cr.task.Key)
				if err := f.Get(ctx, &res); err != nil {
					failed[key] = true
					setTaskRef(status, cr.task.Issue, "", TaskPhaseFailed, OutcomeFailed)
					return
				}
				if res.Outcome == OutcomeSucceeded {
					succeeded[key] = true
				} else {
					failed[key] = true
				}
				setTaskRef(status, cr.task.Issue, "", res.Phase(), res.Outcome)
			})
		}
		sel.Select(ctx)
		if completedIdx >= 0 {
			running = append(running[:completedIdx], running[completedIdx+1:]...)
			finished++
		}
	}
}

// notSucceeded returns the issue labels of every task whose outcome is not
// "succeeded" (failed or dependency-skipped) — the quality bar the validating
// phase enforces before running validation.
func notSucceeded(tasks []DevTaskRef) []string {
	var out []string
	for _, t := range tasks {
		if t.Outcome != OutcomeSucceeded {
			out = append(out, fmt.Sprintf("#%d (%s)", t.Issue, orEmpty(t.Outcome, "incomplete")))
		}
	}
	return out
}

// orEmpty returns fallback when s is empty.
func orEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// setTaskRef updates (in place) the status entry for issue, filling only the
// non-empty fields so a later update does not clobber an earlier workflow id.
func setTaskRef(status *DevFlowStatus, issue int, workflowID, phase, outcome string) {
	for i := range status.Tasks {
		if status.Tasks[i].Issue != issue {
			continue
		}
		if workflowID != "" {
			status.Tasks[i].WorkflowID = workflowID
		}
		if phase != "" {
			status.Tasks[i].Phase = phase
		}
		if outcome != "" {
			status.Tasks[i].Outcome = outcome
		}
		return
	}
	status.Tasks = append(status.Tasks, DevTaskRef{Issue: issue, WorkflowID: workflowID, Phase: phase, Outcome: outcome})
}

// Phase returns a display phase for a finished task result.
func (r TaskFlowResult) Phase() string {
	if r.Outcome == OutcomeSucceeded {
		return TaskPhaseDone
	}
	return TaskPhaseFailed
}

// enumsParentClosePolicyTerminate returns the TERMINATE parent-close policy so
// canceling a dev run tears down its still-running task children.
func enumsParentClosePolicyTerminate() enumspb.ParentClosePolicy {
	return enumspb.PARENT_CLOSE_POLICY_TERMINATE
}

// planActivityOpts returns the activity options for the long-running plan
// activity (heartbeating, single attempt — issue creation is not blind-retry
// safe; the plan service's own lock guards concurrent duplicates).
func planActivityOpts(ctx workflow.Context) workflow.Context {
	return workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Minute,
		HeartbeatTimeout:    2 * time.Minute,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 1},
	})
}

// taskWorkflowID builds the deterministic child workflow id
// (taskflow-<org>-<project>-<tag>-<issueNumber>).
func taskWorkflowID(orgID, projectID, tag string, issue int) string {
	return fmt.Sprintf("taskflow-%s-%s-%s-%d", orgID, projectID, tag, issue)
}
