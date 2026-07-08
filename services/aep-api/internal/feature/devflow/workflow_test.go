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

// registerDevActivities mocks every dev-workflow activity. designExists and
// plannedTasks tune the two branch points the tests exercise.
func registerDevActivities(env *testsuite.TestWorkflowEnvironment, designExists bool, plannedTasks []PlannedTask) {
	var acts *Activities
	env.RegisterActivity(acts.RecordWorkflowRun)
	env.RegisterActivity(acts.SetWorkflowRunStatus)
	env.RegisterActivity(acts.CreateVersionTag)
	env.RegisterActivity(acts.CheckDesignExists)
	env.RegisterActivity(acts.StartDesignTurn)
	env.RegisterActivity(acts.PollDesignTurn)
	env.RegisterActivity(acts.RunPlan)
	env.RegisterActivity(acts.Validate)
	env.OnActivity(acts.RecordWorkflowRun, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.SetWorkflowRunStatus, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.CreateVersionTag, mock.Anything, mock.Anything).Return("v1", nil)
	env.OnActivity(acts.CheckDesignExists, mock.Anything, mock.Anything).Return(designExists, nil)
	env.OnActivity(acts.StartDesignTurn, mock.Anything, mock.Anything).Return("turn1", nil)
	env.OnActivity(acts.PollDesignTurn, mock.Anything, mock.Anything).Return(DesignTurnOutcomeResult{Done: true, Outcome: "completed"}, nil)
	env.OnActivity(acts.RunPlan, mock.Anything, mock.Anything).Return(plannedTasks, nil)
	env.OnActivity(acts.Validate, mock.Anything, mock.Anything).Return(nil)
}

func TestDevFlowWorkflow_HappyPath_DesignGenerated(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	tasks := []PlannedTask{{Issue: 1, Key: "api"}, {Issue: 2, Key: "web"}}
	registerDevActivities(env, false, tasks)
	// Mock the task child workflow so this test stays a dev-workflow unit test.
	env.RegisterWorkflow(TaskFlowWorkflow)
	env.OnWorkflow(TaskFlowWorkflow, mock.Anything, mock.Anything).Return(TaskFlowResult{Outcome: OutcomeSucceeded}, nil)

	// Design was not generated → the workflow waits for the design-turn-done
	// signal; deliver it (matching the started turn id).
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SigDesignTurnDone, DesignTurnDoneSignal{TurnID: "turn1", Outcome: "completed"})
	}, time.Second)

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Tag: "v1"})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, DevPhaseDone, res.Phase)
	require.Len(t, res.Tasks, 2)
}

func TestDevFlowWorkflow_SkipsDesignWhenExists(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	registerDevActivities(env, true, []PlannedTask{{Issue: 1, Key: "api"}})
	env.RegisterWorkflow(TaskFlowWorkflow)
	env.OnWorkflow(TaskFlowWorkflow, mock.Anything, mock.Anything).Return(TaskFlowResult{Outcome: OutcomeSucceeded}, nil)
	// No StartDesignTurn expected — asserting it is never called proves the skip.
	env.OnActivity("StartDesignTurn", mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { t.Fatal("StartDesignTurn called though design already exists") }).
		Return("", nil).Maybe()

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Tag: "v1"})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, DevPhaseDone, res.Phase)
}

func TestDevFlowWorkflow_FailedDepSkipsDependent(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	// web depends on api; api fails → web is skipped, never started.
	tasks := []PlannedTask{
		{Issue: 1, Key: "api"},
		{Issue: 2, Key: "web", DependsOn: []string{"api"}},
	}
	registerDevActivities(env, true, tasks)
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
	registerDevActivities(env, true, cyclic)

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Tag: "v1"})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, DevPhaseFailed, res.Phase)
	require.Contains(t, res.Error, "cycle")
}
