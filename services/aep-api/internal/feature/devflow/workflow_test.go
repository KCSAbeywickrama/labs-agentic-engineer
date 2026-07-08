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

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

// The two workflows are tested in isolation with the Temporal Go SDK test
// suite: activities are mocked, so no Temporal server, DB, or aep-api service
// is needed. This is the "workflows testable separately" goal in practice.

func TestTaskFlowWorkflow_SkeletonCompletes(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()

	var acts *Activities
	env.RegisterActivity(acts.RecordWorkflowRun)
	env.RegisterActivity(acts.SetWorkflowRunStatus)
	env.OnActivity(acts.RecordWorkflowRun, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.SetWorkflowRunStatus, mock.Anything, mock.Anything).Return(nil)

	env.ExecuteWorkflow(TaskFlowWorkflow, TaskFlowInput{
		OrgID: "org1", ProjectID: "proj1", Repo: "org1/proj1", Issue: 7, Tag: "v1-1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res TaskFlowResult
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, 7, res.Issue)
	require.Equal(t, "succeeded", res.Outcome)
}

func TestDevFlowWorkflow_SkeletonCompletes(t *testing.T) {
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()

	var acts *Activities
	env.RegisterActivity(acts.RecordWorkflowRun)
	env.RegisterActivity(acts.SetWorkflowRunStatus)
	env.OnActivity(acts.RecordWorkflowRun, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(acts.SetWorkflowRunStatus, mock.Anything, mock.Anything).Return(nil)

	env.ExecuteWorkflow(DevFlowWorkflow, DevFlowInput{
		OrgID: "org1", ProjectID: "proj1", Tag: "v1",
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var res DevFlowStatus
	require.NoError(t, env.GetWorkflowResult(&res))
	require.Equal(t, DevPhaseDone, res.Phase)
}
