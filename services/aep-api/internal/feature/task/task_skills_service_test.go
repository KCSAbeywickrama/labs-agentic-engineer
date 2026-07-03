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

// UNIT tier: TaskSkillsService.SkillsForTask (backs the runner-facing
// GET /internal/v1/tasks/:taskId/skills). The S2S HTTP surface itself is
// integration-owned (its RunnerScopedInput resolves via the process-global
// auth.SetRunnerAuthorizer the componenttest harness never sets), so the
// service logic is proven here at the unit tier against faked ports.
package task

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/models"
)

// skillsRepo is the narrow {GetByID} port TaskSkillsService takes inline.
type skillsRepo struct {
	fn func(ctx context.Context, id string) (*models.ComponentTask, error)
}

func (r skillsRepo) GetByID(ctx context.Context, id string) (*models.ComponentTask, error) {
	return r.fn(ctx, id)
}

func TestSkillsForTask_UnknownTaskIsNotFound(t *testing.T) {
	t.Parallel()
	svc := NewTaskSkillsService(
		skillsRepo{fn: func(context.Context, string) (*models.ComponentTask, error) { return nil, nil }},
		nil, nil,
	)
	if _, err := svc.SkillsForTask(context.Background(), "missing"); !errors.Is(err, ErrTaskNotFound) {
		t.Fatalf("nil task row must map to ErrTaskNotFound, got %v", err)
	}
}

func TestSkillsForTask_NoStoreOrResolverReturnsEmpty(t *testing.T) {
	t.Parallel()
	// Task exists but store/skillSvc unwired → an empty (non-error) list, so the
	// runner degrades to "no skills" rather than failing the pull.
	svc := NewTaskSkillsService(
		skillsRepo{fn: func(context.Context, string) (*models.ComponentTask, error) {
			return &models.ComponentTask{ID: "t1", OrgID: "acme", ProjectID: "web"}, nil
		}},
		nil, nil,
	)
	resp, err := svc.SkillsForTask(context.Background(), "t1")
	if err != nil || resp == nil || len(resp.Skills) != 0 {
		t.Fatalf("no store/resolver → empty list, got (%v,%v)", resp, err)
	}
}

func TestSkillsForTask_NoAttachedSkillsReturnsEmpty(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			// A design with no `skillsApplied` frontmatter.
			return map[string]string{artifacts.DesignRootFile: "# Overview"}, nil
		},
	}
	svc := NewTaskSkillsService(
		skillsRepo{fn: func(context.Context, string) (*models.ComponentTask, error) {
			return &models.ComponentTask{ID: "t1", OrgID: "acme", ProjectID: "web"}, nil
		}},
		artifacts.NewArtifactStore(fake),
		&fakeSkillResolver{}, // ResolveMany must NOT be called when nothing is attached
	)
	resp, err := svc.SkillsForTask(context.Background(), "t1")
	if err != nil || len(resp.Skills) != 0 {
		t.Fatalf("no attached skills → empty, got (%v,%v)", resp, err)
	}
}

func TestSkillsForTask_ResolvesAttachedSkillsToWireEntries(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{
				artifacts.DesignRootFile: "---\nskillsApplied:\n  - api-management\n---\n# Overview",
			}, nil
		},
	}
	resolver := &fakeSkillResolver{ResolveManyFunc: func(_ context.Context, org string, names []string) ([]models.Skill, error) {
		if org != "acme" || len(names) != 1 || names[0] != "api-management" {
			t.Fatalf("resolver must get the design's attached names for the task org, got org=%q names=%v", org, names)
		}
		return []models.Skill{{
			Kind: "builtin", Name: "api-management", Description: "d", SkillMD: "# body",
			References: map[string]string{"a": "b"},
		}}, nil
	}}
	svc := NewTaskSkillsService(
		skillsRepo{fn: func(context.Context, string) (*models.ComponentTask, error) {
			return &models.ComponentTask{ID: "t1", OrgID: "acme", ProjectID: "web"}, nil
		}},
		artifacts.NewArtifactStore(fake),
		resolver,
	)
	resp, err := svc.SkillsForTask(context.Background(), "t1")
	if err != nil || len(resp.Skills) != 1 {
		t.Fatalf("resolve: got (%v,%v)", resp, err)
	}
	got := resp.Skills[0]
	if got.ID != "builtin/api-management" || got.MaterializedName != "builtin-api-management" || got.SkillMD != "# body" {
		t.Fatalf("wire entry mapping drifted: %+v", got)
	}
}

func TestSkillsForTask_ResolverErrorPropagates(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{artifacts.DesignRootFile: "---\nskillsApplied:\n  - x\n---\n# O"}, nil
		},
	}
	svc := NewTaskSkillsService(
		skillsRepo{fn: func(context.Context, string) (*models.ComponentTask, error) {
			return &models.ComponentTask{ID: "t1", OrgID: "acme", ProjectID: "web"}, nil
		}},
		artifacts.NewArtifactStore(fake),
		&fakeSkillResolver{ResolveManyFunc: func(context.Context, string, []string) ([]models.Skill, error) {
			return nil, errors.New("repo unreachable")
		}},
	)
	if _, err := svc.SkillsForTask(context.Background(), "t1"); err == nil {
		t.Fatal("a skills-resolve failure must propagate")
	}
}
