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

// Package task — typed task-graph generation tests (the D1 integration slice).
//
// These tests assert the persistAndIssue invariants for the typed task graph
// (docs/design/tech-lead-agent.md, plan §4):
//
//   - A component task with an `external` dependency has
//     DependsOnExternalResources populated (platform-authored, not LLM-authored).
//   - A component task with a `platform-resource` dependency has
//     DependsOnResources populated.
//   - A component task with an `org-service` dependency has
//     DependsOnOrgServices populated.
//   - Exactly ONE config-collection task is created per DISTINCT `external`
//     resource the batch binds, with ExternalResourceName set, no GitHub issue.
//   - Exactly ONE resource-provisioning task is created per DISTINCT
//     `platform-resource` dep the batch binds, with ResourceName set, no
//     GitHub issue.
//   - Re-generation (or a batch where several components bind the same
//     resource) does not duplicate an existing config-collection /
//     resource-provisioning task — dedup by ExternalResourceName / ResourceName
//     against both the current batch and previously-persisted project tasks.
package task

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/models"
)

// recordingTaskRepo is a fakeTaskRepo backed by a shared in-memory slice, so
// Create appends and ListByProjectID (used by the dedup passes) reflects
// everything persisted so far — including rows from a prior "generation" the
// test seeds up front. Mirrors the source's stubTaskRepo semantics using this
// repo's house fake style (fakeTaskRepo function fields).
func recordingTaskRepo(seed ...models.ComponentTask) (*fakeTaskRepo, func() []models.ComponentTask) {
	tasks := append([]models.ComponentTask{}, seed...)
	repo := &fakeTaskRepo{}
	repo.CreateFunc = func(_ context.Context, task *models.ComponentTask) error {
		if task.ID == "" {
			task.ID = "t-" + task.ComponentName
		}
		tasks = append(tasks, *task)
		return nil
	}
	repo.ListByProjectIDFunc = func(context.Context, string, string) ([]models.ComponentTask, error) {
		return tasks, nil
	}
	// Issue creation always fails (no issueSvc programmed for CreateIssue); the
	// resulting failure-state Update is expected and ignored by these tests —
	// only the persisted row SHAPE is under test, not issue outcomes.
	repo.UpdateFunc = func(_ context.Context, task *models.ComponentTask) error {
		for i := range tasks {
			if tasks[i].ComponentName == task.ComponentName && tasks[i].Type == task.Type {
				tasks[i] = *task
			}
		}
		return nil
	}
	return repo, func() []models.ComponentTask { return tasks }
}

func findByType(tasks []models.ComponentTask, typ string) []models.ComponentTask {
	var out []models.ComponentTask
	for _, t := range tasks {
		if t.Type == typ {
			out = append(out, t)
		}
	}
	return out
}

// --- platform-resource ---------------------------------------------------------

func TestPersistAndIssue_PlatformResourceDep_CreatesProvisioningRow(t *testing.T) {
	t.Parallel()
	repo, all := recordingTaskRepo()
	svc := streamSvc(repo, nil, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{
		{Name: "api", ComponentType: "service", Language: "Go", Dependencies: []models.Dependency{
			{Kind: models.DependencyKindPlatformResource, Name: "maindb", ResourceType: "postgres-cnpg"},
		}},
	}}
	plan := []planItemFrame{{TempID: "t1", ComponentName: "api", Title: "Implement api"}}

	rows, err := svc.persistAndIssue(context.Background(), newSseWriter(discardWriter{}, nopFlush),
		"org1", "proj1", "batch1", "v1", "v1-1", plan, design, "https://github.com/org/repo", "org/repo")
	if err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("resource-provisioning rows must not ride the issue-creation `rows` slice, got %d", len(rows))
	}

	tasks := all()
	compTasks := findByType(tasks, models.TaskTypeComponent)
	if len(compTasks) != 1 || len(compTasks[0].DependsOnResources) != 1 || compTasks[0].DependsOnResources[0] != "maindb" {
		t.Fatalf("want component task DependsOnResources=[maindb], got %+v", compTasks)
	}

	resTasks := findByType(tasks, models.TaskTypeResourceProvisioning)
	if len(resTasks) != 1 {
		t.Fatalf("want exactly 1 resource-provisioning task, got %d: %+v", len(resTasks), resTasks)
	}
	rt := resTasks[0]
	if rt.ResourceName != "maindb" {
		t.Errorf("want ResourceName=maindb, got %q", rt.ResourceName)
	}
	if rt.Status != string(models.TaskStatusPending) {
		t.Errorf("want Status=pending, got %q", rt.Status)
	}
	if rt.LifecycleStatus != string(models.TaskLifecycleGhIssueCreated) {
		t.Errorf("want LifecycleStatus=gh_issue_created (so GitHub reconcilers skip it), got %q", rt.LifecycleStatus)
	}
	if rt.IssueURL != "" {
		t.Errorf("resource-provisioning task must never get a GitHub issue, got IssueURL=%q", rt.IssueURL)
	}
}

func TestPersistAndIssue_PlatformResourceDep_DedupWithinBatch(t *testing.T) {
	t.Parallel()
	// Two components in the SAME batch bind the same platform-resource — only
	// one resource-provisioning row must be minted for it.
	repo, all := recordingTaskRepo()
	svc := streamSvc(repo, nil, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{
		{Name: "api", Dependencies: []models.Dependency{{Kind: models.DependencyKindPlatformResource, Name: "maindb", ResourceType: "postgres-cnpg"}}},
		{Name: "worker", Dependencies: []models.Dependency{{Kind: models.DependencyKindPlatformResource, Name: "maindb", ResourceType: "postgres-cnpg"}}},
	}}
	plan := []planItemFrame{
		{TempID: "t1", ComponentName: "api", Title: "Implement api"},
		{TempID: "t2", ComponentName: "worker", Title: "Implement worker"},
	}

	if _, err := svc.persistAndIssue(context.Background(), newSseWriter(discardWriter{}, nopFlush),
		"org1", "proj1", "batch1", "v1", "v1-1", plan, design, "", ""); err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}

	resTasks := findByType(all(), models.TaskTypeResourceProvisioning)
	if len(resTasks) != 1 {
		t.Fatalf("want exactly 1 resource-provisioning task for a resource shared within the batch, got %d", len(resTasks))
	}
}

func TestPersistAndIssue_PlatformResourceDep_DedupAgainstExisting(t *testing.T) {
	t.Parallel()
	// A resource-provisioning task for "maindb" already exists from a prior
	// generation; a re-generation binding the same resource must not duplicate it.
	existing := models.ComponentTask{
		Type: models.TaskTypeResourceProvisioning, ResourceName: "maindb", ComponentName: "maindb",
		Title: "Provision resource: maindb", Status: string(models.TaskStatusPending),
		LifecycleStatus: string(models.TaskLifecycleGhIssueCreated),
	}
	repo, all := recordingTaskRepo(existing)
	svc := streamSvc(repo, nil, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{
		{Name: "api", Dependencies: []models.Dependency{{Kind: models.DependencyKindPlatformResource, Name: "maindb", ResourceType: "postgres-cnpg"}}},
	}}
	plan := []planItemFrame{{TempID: "t1", ComponentName: "api", Title: "Implement api"}}

	if _, err := svc.persistAndIssue(context.Background(), newSseWriter(discardWriter{}, nopFlush),
		"org1", "proj1", "batch2", "v1", "v1-2", plan, design, "", ""); err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}

	resTasks := findByType(all(), models.TaskTypeResourceProvisioning)
	if len(resTasks) != 1 {
		t.Fatalf("dedup against existing tasks failed: want 1 resource-provisioning task, got %d", len(resTasks))
	}
}

// --- external resource (config-collection) ------------------------------------

func TestPersistAndIssue_ExternalResourceDep_CreatesConfigCollectionRow(t *testing.T) {
	t.Parallel()
	repo, all := recordingTaskRepo()
	svc := streamSvc(repo, nil, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{
		{Name: "api", Dependencies: []models.Dependency{{Kind: models.DependencyKindExternal, Name: "exchangerate"}}},
	}}
	plan := []planItemFrame{{TempID: "t1", ComponentName: "api", Title: "Implement api"}}

	rows, err := svc.persistAndIssue(context.Background(), newSseWriter(discardWriter{}, nopFlush),
		"org1", "proj1", "batch1", "v1", "v1-1", plan, design, "https://github.com/org/repo", "org/repo")
	if err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("config-collection rows must not ride the issue-creation `rows` slice, got %d", len(rows))
	}

	tasks := all()
	compTasks := findByType(tasks, models.TaskTypeComponent)
	if len(compTasks) != 1 || len(compTasks[0].DependsOnExternalResources) != 1 || compTasks[0].DependsOnExternalResources[0] != "exchangerate" {
		t.Fatalf("want component task DependsOnExternalResources=[exchangerate], got %+v", compTasks)
	}

	ccTasks := findByType(tasks, models.TaskTypeConfigCollection)
	if len(ccTasks) != 1 {
		t.Fatalf("want exactly 1 config-collection task, got %d: %+v", len(ccTasks), ccTasks)
	}
	cc := ccTasks[0]
	if cc.ExternalResourceName != "exchangerate" {
		t.Errorf("want ExternalResourceName=exchangerate, got %q", cc.ExternalResourceName)
	}
	if cc.Status != string(models.TaskStatusPending) {
		t.Errorf("want Status=pending, got %q", cc.Status)
	}
	if cc.LifecycleStatus != string(models.TaskLifecycleGhIssueCreated) {
		t.Errorf("want LifecycleStatus=gh_issue_created (so GitHub reconcilers skip it), got %q", cc.LifecycleStatus)
	}
	if cc.IssueURL != "" {
		t.Errorf("config-collection task must never get a GitHub issue, got IssueURL=%q", cc.IssueURL)
	}
}

func TestPersistAndIssue_ExternalResourceDep_DedupWithinBatch(t *testing.T) {
	t.Parallel()
	// Two components in the SAME batch bind the same external resource — only
	// one config-collection row must be minted for it.
	repo, all := recordingTaskRepo()
	svc := streamSvc(repo, nil, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{
		{Name: "api", Dependencies: []models.Dependency{{Kind: models.DependencyKindExternal, Name: "exchangerate"}}},
		{Name: "worker", Dependencies: []models.Dependency{{Kind: models.DependencyKindExternal, Name: "exchangerate"}}},
	}}
	plan := []planItemFrame{
		{TempID: "t1", ComponentName: "api", Title: "Implement api"},
		{TempID: "t2", ComponentName: "worker", Title: "Implement worker"},
	}

	if _, err := svc.persistAndIssue(context.Background(), newSseWriter(discardWriter{}, nopFlush),
		"org1", "proj1", "batch1", "v1", "v1-1", plan, design, "", ""); err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}

	ccTasks := findByType(all(), models.TaskTypeConfigCollection)
	if len(ccTasks) != 1 {
		t.Fatalf("want exactly 1 config-collection task for a resource shared within the batch, got %d", len(ccTasks))
	}
}

func TestPersistAndIssue_ExternalResourceDep_DedupAgainstExisting(t *testing.T) {
	t.Parallel()
	existing := models.ComponentTask{
		Type: models.TaskTypeConfigCollection, ExternalResourceName: "exchangerate", ComponentName: "exchangerate",
		Title: "Provide configuration: exchangerate", Status: string(models.TaskStatusPending),
		LifecycleStatus: string(models.TaskLifecycleGhIssueCreated),
	}
	repo, all := recordingTaskRepo(existing)
	svc := streamSvc(repo, nil, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{
		{Name: "api", Dependencies: []models.Dependency{{Kind: models.DependencyKindExternal, Name: "exchangerate"}}},
	}}
	plan := []planItemFrame{{TempID: "t1", ComponentName: "api", Title: "Implement api"}}

	if _, err := svc.persistAndIssue(context.Background(), newSseWriter(discardWriter{}, nopFlush),
		"org1", "proj1", "batch2", "v1", "v1-2", plan, design, "", ""); err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}

	ccTasks := findByType(all(), models.TaskTypeConfigCollection)
	if len(ccTasks) != 1 {
		t.Fatalf("dedup against existing tasks failed: want 1 config-collection task, got %d", len(ccTasks))
	}
}

// --- org-service ---------------------------------------------------------------

func TestPersistAndIssue_OrgServiceDep_PopulatesDependsOnOrgServices(t *testing.T) {
	t.Parallel()
	// org-service dependencies are resolved through the org endpoint catalog /
	// access-request flow (P3), not the typed task graph — no row is minted for
	// them, only the gate field on the component task.
	repo, all := recordingTaskRepo()
	svc := streamSvc(repo, nil, nil)

	design := &artifacts.DesignFile{Components: []models.DesignComponent{
		{Name: "api", Dependencies: []models.Dependency{{Kind: models.DependencyKindOrgService, Name: "catalog-product-api"}}},
	}}
	plan := []planItemFrame{{TempID: "t1", ComponentName: "api", Title: "Implement api"}}

	if _, err := svc.persistAndIssue(context.Background(), newSseWriter(discardWriter{}, nopFlush),
		"org1", "proj1", "batch1", "v1", "v1-1", plan, design, "", ""); err != nil {
		t.Fatalf("persistAndIssue: %v", err)
	}

	tasks := all()
	compTasks := findByType(tasks, models.TaskTypeComponent)
	if len(compTasks) != 1 || len(compTasks[0].DependsOnOrgServices) != 1 || compTasks[0].DependsOnOrgServices[0] != "catalog-product-api" {
		t.Fatalf("want component task DependsOnOrgServices=[catalog-product-api], got %+v", compTasks)
	}
	if len(tasks) != 1 {
		t.Fatalf("an org-service dependency must not mint any additional typed task row, got %d tasks: %+v", len(tasks), tasks)
	}
}

// discardWriter is an io.Writer that discards all SSE frames during testing.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
