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

package execution

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/models"
)

// fakeExecLookup fences GetByIDScoped to a single org — a cross-org read misses
// (nil, nil), exactly as the repository does. This is the S2S IDOR fence the
// runner skills route relies on.
type fakeExecLookup struct {
	org string
	row *models.Execution
}

func (f fakeExecLookup) GetByIDScoped(_ context.Context, orgID, _ string) (*models.Execution, error) {
	if orgID != f.org {
		return nil, nil // belongs to another org
	}
	return f.row, nil
}

type fakeDesignSkills struct{ skills []string }

func (f fakeDesignSkills) ReadDesign(context.Context, string, string) (*artifacts.DesignFile, error) {
	return &artifacts.DesignFile{SkillsApplied: f.skills}, nil
}

type fakeSkillResolver struct{}

func (fakeSkillResolver) ResolveMany(_ context.Context, _ string, names []string) ([]models.Skill, error) {
	out := make([]models.Skill, len(names))
	for i, n := range names {
		out[i] = models.Skill{Name: n, Kind: "builtin", SkillMD: "# " + n}
	}
	return out, nil
}

func TestSkillsForExecution_ResolvesDesignSkills(t *testing.T) {
	row := &models.Execution{ID: "e1", OrgID: "acme", ProjectID: "widgets"}
	svc := NewSkillsService(fakeExecLookup{org: "acme", row: row}, fakeDesignSkills{skills: []string{"go", "api-management"}}, fakeSkillResolver{})

	resp, err := svc.SkillsForExecution(context.Background(), "acme", "e1")
	if err != nil {
		t.Fatalf("SkillsForExecution: %v", err)
	}
	if len(resp.Skills) != 2 || resp.Skills[0].Kind != "builtin" || resp.Skills[0].MaterializedName != "builtin-go" {
		t.Fatalf("resolved skills wrong: %+v", resp.Skills)
	}
}

func TestSkillsForExecution_CrossTenant_NotFound(t *testing.T) {
	row := &models.Execution{ID: "e1", OrgID: "acme", ProjectID: "widgets"}
	// The execution belongs to acme; a caller scoped to evil must 404.
	svc := NewSkillsService(fakeExecLookup{org: "acme", row: row}, fakeDesignSkills{}, fakeSkillResolver{})

	if _, err := svc.SkillsForExecution(context.Background(), "evil", "e1"); !errors.Is(err, ErrExecutionNotFound) {
		t.Fatalf("cross-tenant read: err = %v, want ErrExecutionNotFound", err)
	}
}

func TestSkillsForExecution_NoDesignSkills_EmptyList(t *testing.T) {
	row := &models.Execution{ID: "e1", OrgID: "acme", ProjectID: "widgets"}
	svc := NewSkillsService(fakeExecLookup{org: "acme", row: row}, fakeDesignSkills{skills: nil}, fakeSkillResolver{})

	resp, err := svc.SkillsForExecution(context.Background(), "acme", "e1")
	if err != nil {
		t.Fatalf("SkillsForExecution: %v", err)
	}
	if len(resp.Skills) != 0 {
		t.Errorf("expected empty skills, got %+v", resp.Skills)
	}
}
