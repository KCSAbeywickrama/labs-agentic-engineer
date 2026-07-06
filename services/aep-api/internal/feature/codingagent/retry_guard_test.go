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

package codingagent

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// retryGuardRepo is a minimal TaskRepository whose only exercised method is
// GetByID — the Type guard returns before any other repo call, so the embedded
// nil interface is never dereferenced.
type retryGuardRepo struct {
	repositories.TaskRepository
	task *models.ComponentTask
}

func (r *retryGuardRepo) GetByID(_ context.Context, _ string) (*models.ComponentTask, error) {
	return r.task, nil
}

// TestRetryTask_SystemTaskRejected proves the Type guard: a retry on a
// config-collection or resource-provisioning task returns ErrTaskNotRetriable,
// applies NO projector transition, and does NOT mutate the task's status or
// errorMessage.
func TestRetryTask_SystemTaskRejected(t *testing.T) {
	for _, typ := range []string{models.TaskTypeConfigCollection, models.TaskTypeResourceProvisioning} {
		typ := typ
		t.Run(typ, func(t *testing.T) {
			proj := &fakeProjector{}
			task := &models.ComponentTask{
				ID:           "sys-task",
				Type:         typ,
				Status:       string(models.TaskStatusFailed),
				ErrorMessage: "original failure",
			}
			svc := &dispatchService{taskRepo: &retryGuardRepo{task: task}, projector: proj}

			_, err := svc.RetryTask(context.Background(), "sys-task")
			if err == nil {
				t.Fatalf("%s: expected an error", typ)
			}
			if !errors.Is(err, contracts.ErrTaskNotRetriable) {
				t.Fatalf("%s: want ErrTaskNotRetriable, got %v", typ, err)
			}
			if calls := proj.snapshot(); len(calls) != 0 {
				t.Fatalf("%s: guard must apply no transition, got %v", typ, calls)
			}
			if task.Status != string(models.TaskStatusFailed) {
				t.Errorf("%s: status must be unchanged, got %q", typ, task.Status)
			}
			if task.ErrorMessage != "original failure" {
				t.Errorf("%s: errorMessage must be unchanged, got %q", typ, task.ErrorMessage)
			}
		})
	}
}
