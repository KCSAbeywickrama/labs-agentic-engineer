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

package run

import (
	"go.temporal.io/sdk/workflow"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// TaskRunWorkflow works a DEFECT inside a version somebody already delivered: a
// bug or a merge conflict adopted into an already-deployed milestone.
//
// It is the SAME cycle loop the dev run is, with both bookends empty — it plans
// nothing (the milestone was filled by the build that shipped it) and it judges
// nothing (re-validating the whole system for one incident would price every fix
// like a release). Everything that makes the loop safe — the four budgets, the
// no-progress rule, the gate park, cancel re-derived from the row — is therefore
// the same code and not a second copy of it.
//
// Its milestone is somebody else's, which is what makes an empty working set
// meaningless to it: adoption fires on a label write and GitHub's issue index
// lags a write, so a first poll can legitimately precede the issue the run was
// started for. It parks instead of settling (see onEmptyWorkingSet).
func TaskRunWorkflow(ctx workflow.Context, in RunInput) (RunResult, error) {
	l := newLoop(ctx, in)
	if err := workflow.SetQueryHandler(ctx, delivery.QueryRunStatus, func() (delivery.RunStatus, error) {
		return l.st, nil
	}); err != nil {
		return RunResult{}, err
	}
	return l.work(ctx, bookends{
		onEmpty: func(ctx workflow.Context) (RunResult, error) {
			return l.settle(ctx, delivery.RunStateSucceeded, "")
		},
	})
}
