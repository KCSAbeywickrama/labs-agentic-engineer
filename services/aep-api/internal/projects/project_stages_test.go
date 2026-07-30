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

// The #184 stage-aggregate derivation table, pinned row by row against fake
// poll sources. The fixture lives in project_service_test.go.
package projects

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/spec"
)

func devBinding(name, readyStatus, readyReason string) openchoreo.ReleaseBindingSummary {
	return openchoreo.ReleaseBindingSummary{
		ComponentName: name,
		Environment:   "development",
		ReadyStatus:   readyStatus,
		ReadyReason:   readyReason,
	}
}

func mustStatus(t *testing.T, fx statusFixture) *gen.ProjectStatus {
	t.Helper()
	st, err := fx.service().GetProjectStatus(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("GetProjectStatus: %v", err)
	}
	return st
}

// TestStageDerivation_FullPipeline drives all three aggregates at once: a v2
// build running over a deployed v1 — the mid-flight overview.
func TestStageDerivation_FullPipeline(t *testing.T) {
	t.Parallel()
	fx := statusFixture{
		snap: spec.StatusSnapshot{
			HasSpec:     true,
			HasDesign:   true,
			SpecVersion: "v2",
			SpecDirty:   true,
		},
		runs: []delivery.DevflowRun{
			{Tag: "v2", Status: delivery.WorkflowStatusRunning, TasksTotal: 5, TasksDone: 2, TasksFailed: 1},
			{Tag: "v1", Status: delivery.WorkflowStatusCompleted, TasksTotal: 3, TasksDone: 3},
		},
		bindings: []openchoreo.ReleaseBindingSummary{
			devBinding("api", "True", "Ready"),
			devBinding("web", "False", "ResourcesProgressing"),
			{ComponentName: "api", Environment: "production", ReadyStatus: "True", ReadyReason: "Ready"}, // ignored: not dev
		},
		counts: map[string]int{"v1": 3},
	}
	st := mustStatus(t, fx)

	if want := (gen.SpecStage{Exists: true, Version: "v2", Dirty: true, Design: true}); st.Spec != want {
		t.Errorf("spec = %+v, want %+v", st.Spec, want)
	}

	if st.Build.Version != "v2" || st.Build.Status != "running" {
		t.Errorf("build = %s/%s, want v2/running", st.Build.Version, st.Build.Status)
	}
	if st.Build.Tasks.Total != 5 || st.Build.Tasks.Done != 2 || st.Build.Tasks.Failed != 1 || st.Build.Tasks.Active != 2 {
		t.Errorf("build tasks = %+v, want 5/2/1 active 2", st.Build.Tasks)
	}

	if st.Deploy.Version != "v1" {
		t.Errorf("deploy version = %q, want v1 (newest COMPLETED run, not the running v2)", st.Deploy.Version)
	}
	if st.Deploy.Status != "deploying" {
		t.Errorf("deploy status = %q, want deploying (one dev binding not ready)", st.Deploy.Status)
	}
	if st.Deploy.Components.Total != 3 || st.Deploy.Components.Ready != 1 {
		t.Errorf("deploy components = %+v, want 3 total (design at v1) / 1 ready", st.Deploy.Components)
	}
}

// TestBuildStage_RowMapping pins the row→enum mapping and the frozen tally,
// including the active clamp (a lost total write must never render negative).
func TestBuildStage_RowMapping(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		runs       []delivery.DevflowRun
		wantVer    string
		wantStatus string
		wantActive int64
	}{
		{name: "no rows → idle", wantStatus: "idle"},
		{
			name:       "completed → succeeded, tally frozen",
			runs:       []delivery.DevflowRun{{Tag: "v3", Status: delivery.WorkflowStatusCompleted, TasksTotal: 4, TasksDone: 4}},
			wantVer:    "v3",
			wantStatus: "succeeded",
		},
		{
			name:       "failed → failed",
			runs:       []delivery.DevflowRun{{Tag: "v3", Status: delivery.WorkflowStatusFailed, TasksTotal: 2, TasksFailed: 2}},
			wantVer:    "v3",
			wantStatus: "failed",
		},
		{
			name:       "canceled → failed",
			runs:       []delivery.DevflowRun{{Tag: "v3", Status: delivery.WorkflowStatusCanceled}},
			wantVer:    "v3",
			wantStatus: "failed",
		},
		{
			name:       "active clamps at zero when the total write was lost",
			runs:       []delivery.DevflowRun{{Tag: "v3", Status: delivery.WorkflowStatusRunning, TasksDone: 2}},
			wantVer:    "v3",
			wantStatus: "running",
			wantActive: 0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// A completed run becomes deploy.version → the denominator read
			// runs; give it a count so this test stays about the build row.
			st := mustStatus(t, statusFixture{runs: tc.runs, counts: map[string]int{"v3": 4}})
			if st.Build.Version != tc.wantVer || st.Build.Status != tc.wantStatus {
				t.Errorf("build = %s/%s, want %s/%s", st.Build.Version, st.Build.Status, tc.wantVer, tc.wantStatus)
			}
			if st.Build.Tasks.Active != tc.wantActive {
				t.Errorf("active = %d, want %d", st.Build.Tasks.Active, tc.wantActive)
			}
			if len(tc.runs) > 0 {
				row := tc.runs[0]
				if st.Build.Tasks.Total != int64(row.TasksTotal) || st.Build.Tasks.Done != int64(row.TasksDone) || st.Build.Tasks.Failed != int64(row.TasksFailed) {
					t.Errorf("tally = %+v, want the row's %d/%d/%d verbatim", st.Build.Tasks, row.TasksTotal, row.TasksDone, row.TasksFailed)
				}
			}
		})
	}
}

// TestBuildStage_ValidationFailureAttribution pins the carve-out: a dev run
// that the workflow stamped DevFailureValidationPhase on reports build=succeeded
// — the failure belongs to validation and already rides
// deploy.validation=errored. Every other failure shape keeps the raw failed
// mapping.
//
// Attribution reads the dev row's OWN recorded cause, so the validation child row
// is irrelevant to it. That retires the tally-shape and recency guards this test
// used to exercise: both existed only to work around a stale validation row
// matching a same-tag rebuild, and a cause written by the execution that failed
// cannot be stale.
func TestBuildStage_ValidationFailureAttribution(t *testing.T) {
	t.Parallel()
	base := time.Unix(1700000000, 0)
	devRun := func(status string, total, done, failed int) []delivery.DevflowRun {
		return []delivery.DevflowRun{{
			Tag: "v1", WorkflowID: "wf-dev", Status: status,
			TasksTotal: total, TasksDone: done, TasksFailed: failed,
			CreatedAt: base,
		}}
	}
	// attributed is a dev row the workflow stamped as validation-phase-failed.
	attributed := func(total, done, failed int) []delivery.DevflowRun {
		runs := devRun(delivery.WorkflowStatusFailed, total, done, failed)
		runs[0].FailureKind = delivery.DevFailureValidationPhase
		return runs
	}
	// childAt is a validation row at an arbitrary time. Attribution no longer
	// reads it at all — the dev row carries its own cause — so these exist only to
	// prove the child cannot sway the build status either way.
	childAt := func(status string, createdAt time.Time) *delivery.DevflowRun {
		return &delivery.DevflowRun{
			Kind: delivery.WorkflowKindValidation,
			Repo: "o/r", IssueNumber: 9, ParentWorkflowID: "wf-dev", Status: status,
			CreatedAt: createdAt,
		}
	}
	child := func(status string) *delivery.DevflowRun { return childAt(status, base.Add(time.Hour)) }
	staleChild := func(status string) *delivery.DevflowRun { return childAt(status, base.Add(-time.Hour)) }
	cases := []struct {
		name           string
		runs           []delivery.DevflowRun
		child          *delivery.DevflowRun
		wantBuild      string
		wantValidation string
	}{
		{
			name: "validation-attributed failure → build succeeded",
			runs: attributed(3, 3, 0), child: child(delivery.WorkflowStatusFailed),
			wantBuild: "succeeded", wantValidation: "errored",
		},
		{
			// The cause is stamped by the execution that failed, so a leftover
			// validation row from a previous same-tag execution cannot change the
			// answer. This case needed a recency guard before; now it is simply
			// not a question the status builder asks.
			name: "attributed failure with a stale validation row → still build succeeded",
			runs: attributed(3, 3, 0), child: staleChild(delivery.WorkflowStatusFailed),
			wantBuild: "succeeded", wantValidation: "errored",
		},
		{
			// A coding failure carries no validation cause, so it is never carved
			// out — regardless of what validation row happens to match.
			name: "coding failure → build failed",
			runs: devRun(delivery.WorkflowStatusFailed, 3, 1, 2), child: child(delivery.WorkflowStatusFailed),
			wantBuild: "failed", wantValidation: "errored",
		},
		{
			name: "provisioning failure (empty tally) → build failed",
			runs: devRun(delivery.WorkflowStatusFailed, 0, 0, 0), child: child(delivery.WorkflowStatusFailed),
			wantBuild: "failed", wantValidation: "errored",
		},
		{
			// A green tally alone no longer attributes anything: without the
			// stamped cause this is a run that failed somewhere else entirely.
			name: "green tally but no recorded cause → build failed",
			runs: devRun(delivery.WorkflowStatusFailed, 3, 3, 0), child: child(delivery.WorkflowStatusFailed),
			wantBuild: "failed", wantValidation: "errored",
		},
		{
			name: "failed without a validation child → build failed",
			runs: devRun(delivery.WorkflowStatusFailed, 3, 3, 0), child: nil,
			wantBuild: "failed", wantValidation: "none",
		},
		{
			name: "canceled run is not carved out",
			runs: devRun(delivery.WorkflowStatusCanceled, 3, 3, 0), child: child(delivery.WorkflowStatusFailed),
			wantBuild: "failed", wantValidation: "errored",
		},
		{
			name: "validation still running → build failed",
			runs: devRun(delivery.WorkflowStatusFailed, 3, 3, 0), child: child(delivery.WorkflowStatusRunning),
			wantBuild: "failed", wantValidation: "running",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := mustStatus(t, statusFixture{runs: tc.runs, validationRun: tc.child})
			if st.Build.Status != tc.wantBuild {
				t.Errorf("build status = %q, want %q", st.Build.Status, tc.wantBuild)
			}
			if string(st.Deploy.Validation) != tc.wantValidation {
				t.Errorf("deploy.validation = %q, want %q", st.Deploy.Validation, tc.wantValidation)
			}
		})
	}
}

// TestDeployStage_ConditionMatrix pins the condition-driven status: failed >
// deploying > deployed, none without bindings; undeploy-state and non-dev
// bindings excluded; unknown reasons read as deploying, never failed.
func TestDeployStage_ConditionMatrix(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		bindings   []openchoreo.ReleaseBindingSummary
		wantStatus string
		wantReady  int64
	}{
		{name: "no bindings → none", wantStatus: "none"},
		{
			name: "all ready → deployed",
			bindings: []openchoreo.ReleaseBindingSummary{
				devBinding("api", "True", "Ready"),
				devBinding("web", "True", "Ready"),
			},
			wantStatus: "deployed",
			wantReady:  2,
		},
		{
			name: "any failure reason wins over progress",
			bindings: []openchoreo.ReleaseBindingSummary{
				devBinding("api", "True", "Ready"),
				devBinding("web", "False", "ResourcesProgressing"),
				devBinding("db", "False", "ResourceApplyFailed"),
			},
			wantStatus: "failed",
			wantReady:  1,
		},
		{
			name: "unknown not-ready reason → deploying (forgiving default)",
			bindings: []openchoreo.ReleaseBindingSummary{
				devBinding("api", "False", "SomeNewReason"),
			},
			wantStatus: "deploying",
		},
		{
			name: "absent Ready condition → deploying",
			bindings: []openchoreo.ReleaseBindingSummary{
				devBinding("api", "", ""),
			},
			wantStatus: "deploying",
		},
		{
			name: "undeploy-state binding excluded from status and counts",
			bindings: []openchoreo.ReleaseBindingSummary{
				devBinding("api", "True", "Ready"),
				{ComponentName: "web", Environment: "development", Undeploy: true, ReadyStatus: "False", ReadyReason: "ResourcesUndeployed"},
			},
			wantStatus: "deployed",
			wantReady:  1,
		},
		{
			name: "only non-dev bindings → none",
			bindings: []openchoreo.ReleaseBindingSummary{
				{ComponentName: "api", Environment: "production", ReadyStatus: "True", ReadyReason: "Ready"},
			},
			wantStatus: "none",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := mustStatus(t, statusFixture{bindings: tc.bindings})
			if st.Deploy.Status != tc.wantStatus {
				t.Errorf("deploy status = %q, want %q", st.Deploy.Status, tc.wantStatus)
			}
			if st.Deploy.Components.Ready != tc.wantReady {
				t.Errorf("ready = %d, want %d", st.Deploy.Components.Ready, tc.wantReady)
			}
		})
	}
}

// TestDeployStage_VanishedTagDegrades: a deploy tag missing from the local
// mirror (deleted on GitHub, or a stale run row) is a data state, not a
// source outage — the poll must stay alive with an unknown denominator, not
// 500 forever.
func TestDeployStage_VanishedTagDegrades(t *testing.T) {
	t.Parallel()
	fx := statusFixture{
		runs:     []delivery.DevflowRun{{Tag: "v1", Status: delivery.WorkflowStatusCompleted}},
		countErr: fmt.Errorf("wrapped: %w", spec.ErrSpecTagNotFound),
		bindings: []openchoreo.ReleaseBindingSummary{devBinding("api", "True", "Ready")},
	}
	st := mustStatus(t, fx)
	if st.Deploy.Version != "v1" || st.Deploy.Status != "deployed" {
		t.Errorf("deploy = %s/%s, want v1/deployed (degraded, not failed)", st.Deploy.Version, st.Deploy.Status)
	}
	if st.Deploy.Components.Total != 0 || st.Deploy.Components.Ready != 1 {
		t.Errorf("components = %+v, want 0 total (unknown) / 1 ready", st.Deploy.Components)
	}
}

// TestDeployStage_VersionlessSkipsDenominator: with no completed run there is
// no deployed tag — the denominator read must not happen (the fixture errors
// on any unexpected tag) and counts stay 0/0.
func TestDeployStage_VersionlessSkipsDenominator(t *testing.T) {
	t.Parallel()
	fx := statusFixture{
		runs: []delivery.DevflowRun{{Tag: "v1", Status: delivery.WorkflowStatusRunning}},
	}
	st := mustStatus(t, fx)
	if st.Deploy.Version != "" {
		t.Errorf("deploy version = %q, want \"\" (no completed run)", st.Deploy.Version)
	}
	if st.Deploy.Components.Total != 0 || st.Deploy.Components.Ready != 0 {
		t.Errorf("components = %+v, want 0/0", st.Deploy.Components)
	}
}

// TestDeployStage_ValidationDerivation pins deploy.validation + validationUrl:
// the coarse run state of the newest build's validation child, and the PR link
// (the validation issue as a fallback before a PR exists) — all from cheap DB
// reads (no GitHub in the poll path).
func TestDeployStage_ValidationDerivation(t *testing.T) {
	t.Parallel()

	// A dev run must exist for the builder to look up its validation child; keep
	// it running (no completed run) so this test stays about validation, not the
	// deploy denominator.
	devRuns := []delivery.DevflowRun{{Tag: "v1", WorkflowID: "wf-dev", Status: delivery.WorkflowStatusRunning}}
	child := func(status string) *delivery.DevflowRun {
		return &delivery.DevflowRun{
			Kind: delivery.WorkflowKindValidation,
			Repo: "o/r", IssueNumber: 9, ParentWorkflowID: "wf-dev", Status: status,
		}
	}
	// A succeeded coding execution stamped with the open PR number (pr#42) is how
	// the PR link is recovered without a live PR query.
	prExecs := &fakeExecs{
		LatestPerKindScopedFunc: func(context.Context, string, string, int) (map[string]*delivery.Execution, error) {
			return map[string]*delivery.Execution{
				string(taskmeta.KindCoding): {
					Kind:   string(taskmeta.KindCoding),
					Status: string(taskmeta.ExecSucceeded),
					Reason: taskmeta.ReasonPROpenPrefix + "42",
				},
			}, nil
		},
	}

	cases := []struct {
		name       string
		child      *delivery.DevflowRun
		execs      delivery.ExecutionRepository
		wantStatus string
		wantURL    string
		wantIssue  int64
	}{
		{name: "no child → none, no link", wantStatus: "none", wantURL: ""},
		{
			name:       "running before a PR → running, issue link",
			child:      child(delivery.WorkflowStatusRunning),
			wantStatus: "running",
			wantURL:    "https://github.com/o/r/issues/9",
			wantIssue:  9,
		},
		{
			name:       "completed with an open PR → finished, PR link",
			child:      child(delivery.WorkflowStatusCompleted),
			execs:      prExecs,
			wantStatus: "finished",
			wantURL:    "https://github.com/o/r/pull/42",
			wantIssue:  9,
		},
		{
			name:       "failed → errored, issue link (no succeeded coding row)",
			child:      child(delivery.WorkflowStatusFailed),
			wantStatus: "errored",
			wantURL:    "https://github.com/o/r/issues/9",
			wantIssue:  9,
		},
		{
			// Canceled is its own value now: a human stopping a run is not the
			// machinery breaking, and folding it into errored would make a retry
			// policy treat a deliberate stop as a fault.
			name:       "canceled → canceled",
			child:      child(delivery.WorkflowStatusCanceled),
			wantStatus: "canceled",
			wantURL:    "https://github.com/o/r/issues/9",
			wantIssue:  9,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := mustStatus(t, statusFixture{runs: devRuns, validationRun: tc.child, execs: tc.execs})
			if string(st.Deploy.Validation) != tc.wantStatus {
				t.Errorf("validation = %q, want %q", st.Deploy.Validation, tc.wantStatus)
			}
			if st.Deploy.ValidationURL != tc.wantURL {
				t.Errorf("validationUrl = %q, want %q", st.Deploy.ValidationURL, tc.wantURL)
			}
			if st.Deploy.ValidationIssue != tc.wantIssue {
				t.Errorf("validationIssue = %d, want %d", st.Deploy.ValidationIssue, tc.wantIssue)
			}
		})
	}
}

// TestRepoNotReady_ZeroValueStages pins the short-circuit: the nested stages
// are contract-required, so a pending repo returns them present but
// zero-valued — idle build, no deploy, empty spec.
func TestRepoNotReady_ZeroValueStages(t *testing.T) {
	t.Parallel()
	repoSvc := &fakeRepoSvc{
		GetRepoFunc: func(context.Context, string, string) (*sourcecontrol.GitRepository, error) {
			return &sourcecontrol.GitRepository{Status: "pending", RepoURL: "https://github.com/o/r.git"}, nil
		},
	}
	// Sources deliberately unwired: the short-circuit must not touch them.
	svc := NewProjectService(nil, repoSvc, nil, nil, nil)
	st, err := svc.GetProjectStatus(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("GetProjectStatus: %v", err)
	}
	if st.Phase != "repo-cloning" {
		t.Fatalf("phase = %q, want repo-cloning", st.Phase)
	}
	if st.Spec != (gen.SpecStage{}) {
		t.Errorf("spec = %+v, want zero-valued", st.Spec)
	}
	if st.Build.Status != "idle" || st.Build.Version != "" || st.Build.Tasks.Total != 0 {
		t.Errorf("build = %+v, want idle zero-valued", st.Build)
	}
	if st.Deploy.Status != "none" || st.Deploy.Version != "" || st.Deploy.Components.Total != 0 {
		t.Errorf("deploy = %+v, want none zero-valued", st.Deploy)
	}
}
