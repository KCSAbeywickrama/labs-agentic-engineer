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

package activities

import (
	"context"

	"github.com/wso2/labs-agentic-engineer/services/orchestrator/internal/types"
)

// Activity names, referenced by the workflows via string so the (deterministic)
// workflows package never imports this one.
const (
	ActivityPlanTasks     = "PlanTasks"
	ActivityRunGateChecks = "RunGateChecks"
	ActivityDispatchTask  = "DispatchTask"
	ActivityAutoMerge     = "AutoMerge"
)

// The methods below are O3 STUBS. They make registration/signatures real so the
// Temporal test env and worker accept them; tests override behavior with
// env.OnActivity(...). Real bodies (read design, k8s Job dispatch, GitHub
// auto-merge, agent self-review) land in O4 against the database client +
// packages/clients. All must remain idempotent (ADR-0004).

// PlanTasks derives the implement DAG from the approved design.
func (Activities) PlanTasks(_ context.Context, _ types.DevelopmentFlowInput) ([]types.TaskSpec, error) {
	return nil, nil
}

// RunGateChecks runs the automated gate (tests/lint/agent self-review) for a
// stage in `auto` mode. O3 stub passes by default.
func (Activities) RunGateChecks(_ context.Context, _ string) (types.GateChecksResult, error) {
	return types.GateChecksResult{Passed: true}, nil
}

// DispatchTask dispatches a coding-agent run for a task (a k8s Job in O4).
func (Activities) DispatchTask(_ context.Context, _ types.TaskLifecycleInput) error {
	return nil
}

// AutoMerge merges a task's PR in `auto` code-review mode; the merge surfaces as
// a PRMerged signal via the GitHub webhook path.
func (Activities) AutoMerge(_ context.Context, _ types.TaskLifecycleInput) error {
	return nil
}
