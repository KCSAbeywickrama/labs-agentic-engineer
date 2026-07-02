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

package task

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/auth"
)

// runnerSkillsOutput is the runner skills response. The Body field serializes
// directly as the response (no envelope) — byte-compatible with the pre-Huma
// raw handler's utils.WriteSuccessResponse({"skills":[...]}).
type runnerSkillsOutput struct{ Body *TaskSkillsResponse }

// RegisterInternalTask registers the runner-facing per-task operations on the
// internal S2S Huma API. Auth (dual-token verify + INT-6 fence) is by
// construction via auth.RunnerScopedInput — same path + tokens as the old raw
// taskController.Skills handler, now with a typed, spec-described contract.
func RegisterInternalTask(api huma.API, skillsSvc *TaskSkillsService) {
	huma.Register(api, huma.Operation{
		OperationID: "runner-skills",
		Method:      http.MethodGet,
		Path:        "/internal/v1/tasks/{taskId}/skills",
		Summary:     "Fetch the snapshotted skill bodies for a task (runner callback)",
		Tags:        []string{"Internal"},
		Security:    auth.SecurityRunner,
	}, func(ctx context.Context, in *auth.RunnerScopedInput) (*runnerSkillsOutput, error) {
		if skillsSvc == nil {
			return nil, huma.Error503ServiceUnavailable("skills endpoint not configured")
		}
		resp, err := skillsSvc.SkillsForTask(ctx, in.TaskID)
		if err != nil {
			if errors.Is(err, ErrTaskNotFound) {
				return nil, huma.Error404NotFound("task not found")
			}
			return nil, huma.Error500InternalServerError("failed to read skills")
		}
		return &runnerSkillsOutput{Body: resp}, nil
	})
}
