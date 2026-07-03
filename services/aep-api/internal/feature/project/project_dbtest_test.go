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

package project

// DBTEST tier (skips under -short; `make test-db` runs it): GetProjectStatus
// driven end-through with the REAL repositories.TaskRepository on a pristine
// per-test Postgres (dbtest.New). The SQL-shaped behavior under test is the
// org scoping of the task lookup: HasTasks must key on (org_id, project_id) —
// another org's tasks under the SAME project slug must not bleed into this
// org's status. The by-UUID isolation of the repository itself is proven in
// repositories/task_repository_dbtest_test.go; this proves the feature path
// consumes it org-scoped.

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

func TestGetProjectStatus_TasksAreOrgScoped_DB(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()

	taskRepo := repositories.NewTaskRepository(db)
	seed := &models.ComponentTask{
		OrgID:         "acme",
		ProjectID:     "web",
		ComponentName: "svc-a",
		Status:        string(models.TaskStatusPending),
	}
	if err := taskRepo.Create(ctx, seed); err != nil {
		t.Fatalf("seed task: %v", err)
	}

	// Repo ready + approved spec + assembled design, so the ladder reaches the
	// task query — those seams are unit-proven, faked here.
	fakeArtifacts := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R"}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{artifacts.DesignRootFile: "# Design"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}}, nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v1-1"}}, nil
		},
	}
	repoSvc := &fakeRepoSvc{GetRepoFunc: func(context.Context, string, string) (*models.GitRepository, error) {
		return &models.GitRepository{Status: "ready", RepoURL: "https://github.com/o/r.git"}, nil
	}}
	svc := NewProjectService(nil, repoSvc, nil, fakeArtifacts, artifacts.NewArtifactStore(fakeArtifacts), taskRepo)

	// The owner org sees its task: phase components.
	st, err := svc.GetProjectStatus(ctx, "acme", "web")
	if err != nil {
		t.Fatalf("status(acme): %v", err)
	}
	if !st.HasTasks || st.Phase != "components" {
		t.Fatalf("owner org: want hasTasks/components, got hasTasks=%v phase=%q", st.HasTasks, st.Phase)
	}

	// A DIFFERENT org asking about the SAME project slug must not see them:
	// the task query is (org_id, project_id)-scoped, so the ladder stops at
	// phase tasks with HasTasks false.
	st, err = svc.GetProjectStatus(ctx, "intruder", "web")
	if err != nil {
		t.Fatalf("status(intruder): %v", err)
	}
	if st.HasTasks || st.Phase != "tasks" {
		t.Fatalf("cross-org: tasks must not bleed across orgs, got hasTasks=%v phase=%q", st.HasTasks, st.Phase)
	}
}
