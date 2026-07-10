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
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// The two workflows are tested in isolation with the Temporal Go SDK test
// suite: activities are mocked, so no Temporal server, DB, or aep-api service
// is needed. This is the "workflows testable separately" goal in practice.

// registerTaskActivities wires the activities the task workflow calls, mocking
// each to succeed. DispatchCoding returns a stub execution id.
func registerTaskActivities(env *testsuite.TestWorkflowEnvironment) {
	var acts *Activities
	env.RegisterActivity(acts.RecordWorkflowRun)
	env.RegisterActivity(acts.SetWorkflowRunStatus)
	env.RegisterActivity(acts.DispatchCoding)
	env.RegisterActivity(acts.MergePR)
	env.OnActivity(acts.RecordWorkflowRun, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.SetWorkflowRunStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.DispatchCoding, mock.Anything, mock.Anything).Return("exec-1", nil)
	env.OnActivity(acts.MergePR, mock.Anything, mock.Anything).Return(nil)
}

func TestTaskFlowWorkflow_HappyPath_AutoGates(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	registerTaskActivities(env)

	// Drive the signal sequence a real webhook/watcher run would produce.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigPROpened, PRSignal{Repo: "org1/proj1", Issue: 7, PRNumber: 42})
	}, time.Second)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigPRMerged, PRSignal{Repo: "org1/proj1", Issue: 7, PRNumber: 42, MergeSHA: "abc"})
	}, 2*time.Second)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigBuildStatus, RunStatusSignal{Phase: PhaseSucceeded})
	}, 3*time.Second)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigDeployStatus, RunStatusSignal{Phase: PhaseSucceeded})
	}, 4*time.Second)

	env.ExecuteWorkflow(TaskFlowWorkflow, TaskFlowInput{
		OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Issue: 7, Tag: "v1-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res TaskFlowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, OutcomeSucceeded, res.Outcome)
}

func TestTaskFlowWorkflow_CodingFails(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	registerTaskActivities(env)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigJobStatus, RunStatusSignal{Phase: PhaseFailed, Message: "boom"})
	}, time.Second)

	env.ExecuteWorkflow(TaskFlowWorkflow, TaskFlowInput{
		OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Issue: 7, Tag: "v1-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res TaskFlowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, OutcomeFailed, res.Outcome)
	require.Contains(t, res.Error, "boom")
}

func TestTaskFlowWorkflow_PRRejected(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	registerTaskActivities(env)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigPROpened, PRSignal{Repo: "org1/proj1", Issue: 7, PRNumber: 42})
	}, time.Second)
	// Auto-merge activity runs, but the merge webhook reports the PR was closed
	// without merging.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigPRRejected, PRSignal{Repo: "org1/proj1", Issue: 7, PRNumber: 42})
	}, 2*time.Second)

	env.ExecuteWorkflow(TaskFlowWorkflow, TaskFlowInput{
		OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Issue: 7, Tag: "v1-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res TaskFlowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, OutcomeFailed, res.Outcome)
}

func TestTaskFlowWorkflow_ManualMergeGate_Approve(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	registerTaskActivities(env)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigPROpened, PRSignal{Repo: "org1/proj1", Issue: 7, PRNumber: 42})
	}, time.Second)
	// Human approves the merge gate; platform then merges + the webhook confirms.
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigGateDecision, GateDecisionSignal{Gate: GateMergePR, Approve: true, Actor: "alice"})
	}, 2*time.Second)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigPRMerged, PRSignal{Repo: "org1/proj1", Issue: 7, PRNumber: 42, MergeSHA: "abc"})
	}, 3*time.Second)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigBuildStatus, RunStatusSignal{Phase: PhaseSucceeded})
	}, 4*time.Second)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigDeployStatus, RunStatusSignal{Phase: PhaseSucceeded})
	}, 5*time.Second)

	env.ExecuteWorkflow(TaskFlowWorkflow, TaskFlowInput{
		OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Issue: 7, Tag: "v1-1",
		Gates: GateConfig{Auto: map[string]bool{GateMergePR: false}},
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res TaskFlowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, OutcomeSucceeded, res.Outcome)
}

// registerDevActivities mocks every dev-workflow activity. plannedTasks tunes
// the plan the fan-out schedules.
func registerDevActivities(env *testsuite.TestWorkflowEnvironment, plannedTasks []PlannedTask) {
	var acts *Activities
	env.RegisterActivity(acts.RecordWorkflowRun)
	env.RegisterActivity(acts.SetWorkflowRunStatus)
	env.RegisterActivity(acts.ValidateSpecAtTag)
	env.RegisterActivity(acts.RunPlan)
	env.RegisterActivity(acts.ProvisionDependencies)
	env.RegisterActivity(acts.Validate)
	env.OnActivity(acts.RecordWorkflowRun, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.SetWorkflowRunStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.ValidateSpecAtTag, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.RunPlan, mock.Anything, mock.Anything).Return(plannedTasks, nil)
	env.OnActivity(acts.ProvisionDependencies, mock.Anything, mock.Anything).Return([]ProvisionFailure(nil), nil)
	env.OnActivity(acts.Validate, mock.Anything, mock.Anything).Return(nil)
}

func TestDevFlowWorkflow_HappyPath(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	tasks := []PlannedTask{{Issue: 1, Key: "api"}, {Issue: 2, Key: "web"}}
	registerDevActivities(env, tasks)
	// Mock the task child workflow so this test stays a dev-workflow unit test.
	env.RegisterWorkflow(TaskFlowWorkflow)
	env.OnWorkflow(TaskFlowWorkflow, mock.Anything, mock.Anything).Return(TaskFlowResult{Outcome: OutcomeSucceeded}, nil)

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Tag: "v1"})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, DevPhaseDone, res.Phase)
	require.Equal(t, "v1", res.Tag)
	require.Len(t, res.Tasks, 2)
}

// TestDevFlowWorkflow_SpecValidationFails pins the validation-only design
// step: an unbuildable tag fails the run before any planning happens.
func TestDevFlowWorkflow_SpecValidationFails(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	var acts *Activities
	env.RegisterActivity(acts.RecordWorkflowRun)
	env.RegisterActivity(acts.SetWorkflowRunStatus)
	env.RegisterActivity(acts.ValidateSpecAtTag)
	env.RegisterActivity(acts.RunPlan)
	env.OnActivity(acts.RecordWorkflowRun, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.SetWorkflowRunStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.ValidateSpecAtTag, mock.Anything, mock.Anything).
		Return(errors.New("spec validation failed: specs/design/design.md missing"))
	env.OnActivity(acts.RunPlan, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { t.Fatal("RunPlan called though the spec failed validation") }).
		Return([]PlannedTask{}, nil).Maybe()

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Tag: "v1"})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, DevPhaseFailed, res.Phase)
	require.Contains(t, res.Error, "validate spec at tag")
}

func TestDevFlowWorkflow_FailedDepSkipsDependent(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	// web depends on api; api fails → web is skipped, never started.
	tasks := []PlannedTask{
		{Issue: 1, Key: "api"},
		{Issue: 2, Key: "web", DependsOn: []string{"api"}},
	}
	registerDevActivities(env, tasks)
	env.RegisterWorkflow(TaskFlowWorkflow)
	// api (issue 1) fails; web (issue 2) must never be invoked.
	env.OnWorkflow(TaskFlowWorkflow, mock.Anything, mock.MatchedBy(func(in TaskFlowInput) bool { return in.Issue == 1 })).
		Return(TaskFlowResult{Outcome: OutcomeFailed}, nil)
	env.OnWorkflow(TaskFlowWorkflow, mock.Anything, mock.MatchedBy(func(in TaskFlowInput) bool { return in.Issue == 2 })).
		Run(func(mock.Arguments) { t.Fatal("dependent task started though its dependency failed") }).
		Return(TaskFlowResult{Outcome: OutcomeSucceeded}, nil).Maybe()

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Tag: "v1"})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	// The dev workflow still completes; the skipped dependent shows in its tasks.
	var web DevTaskRef
	for _, tr := range res.Tasks {
		if tr.Issue == 2 {
			web = tr
		}
	}
	require.Equal(t, OutcomeSkippedDepFai, web.Outcome)
}

func TestDevFlowWorkflow_CycleFastFails(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	// a → b → a is an unsatisfiable cycle.
	cyclic := []PlannedTask{
		{Issue: 1, Key: "a", DependsOn: []string{"b"}},
		{Issue: 2, Key: "b", DependsOn: []string{"a"}},
	}
	registerDevActivities(env, cyclic)

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Tag: "v1"})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, DevPhaseFailed, res.Phase)
	require.Contains(t, res.Error, "cycle")
}
