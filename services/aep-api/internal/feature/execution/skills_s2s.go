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
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/models"
)

// ErrExecutionNotFound is returned when an execution id does not resolve within
// the acting org (mapped to 404).
var ErrExecutionNotFound = errors.New("execution not found")

// The skills-read ports. Wired from the executions repository, artifacts store,
// and skills service at the composition root.

// ExecutionLookup resolves an execution id within the acting org (the S2S fence).
type ExecutionLookup interface {
	GetByIDScoped(ctx context.Context, orgID, id string) (*models.Execution, error)
}

// DesignSkills reads the project's design (its skillsApplied) at HEAD.
type DesignSkills interface {
	ReadDesign(ctx context.Context, orgID, projectID string) (*artifacts.DesignFile, error)
}

// SkillResolver resolves skill names against the org's skills repo at HEAD.
type SkillResolver interface {
	ResolveMany(ctx context.Context, orgID string, names []string) ([]models.Skill, error)
}

// SkillEntry is one row of the runner skills-pull response.
type SkillEntry struct {
	ID               string            `json:"id"`
	MaterializedName string            `json:"materializedName"`
	Kind             string            `json:"kind"`
	SkillMD          string            `json:"skillMd"`
	References       map[string]string `json:"references"`
}

// SkillsResponse is the runner skills-pull wire body.
type SkillsResponse struct {
	Skills []SkillEntry `json:"skills"`
}

// SkillsService backs GET /internal/v1/executions/{executionId}/skills — the
// runner-scoped skills read re-keyed from task to execution (§9.2). It resolves
// the Execution → its project design's skillsApplied → the org's skills at HEAD
// (mid-flight drift accepted, as with the task-keyed original).
type SkillsService struct {
	execs    ExecutionLookup
	design   DesignSkills
	skillSvc SkillResolver
}

// NewSkillsService wires the skills read.
func NewSkillsService(execs ExecutionLookup, design DesignSkills, skillSvc SkillResolver) *SkillsService {
	return &SkillsService{execs: execs, design: design, skillSvc: skillSvc}
}

// SkillsForExecution resolves the execution (fenced to orgHandle) → design
// skillsApplied → resolved skills. Returns an empty list (not an error) when the
// design has no attached skills, and ErrExecutionNotFound for an unknown id.
func (s *SkillsService) SkillsForExecution(ctx context.Context, orgHandle, executionID string) (*SkillsResponse, error) {
	empty := &SkillsResponse{Skills: []SkillEntry{}}
	row, err := s.execs.GetByIDScoped(ctx, orgHandle, executionID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, ErrExecutionNotFound
	}
	if s.design == nil || s.skillSvc == nil {
		return empty, nil
	}
	design, err := s.design.ReadDesign(ctx, row.OrgID, row.ProjectID)
	if err != nil {
		return nil, err
	}
	if design == nil || len(design.SkillsApplied) == 0 {
		return empty, nil
	}
	resolved, err := s.skillSvc.ResolveMany(ctx, row.OrgID, design.SkillsApplied)
	if err != nil {
		return nil, err
	}
	out := make([]SkillEntry, 0, len(resolved))
	for _, sk := range resolved {
		out = append(out, SkillEntry{
			ID:               models.PrefixedID(sk.Kind, sk.Name),
			MaterializedName: models.MaterializedName(sk.Kind, sk.Name),
			Kind:             sk.Kind,
			SkillMD:          sk.SkillMD,
			References:       sk.References,
		})
	}
	return &SkillsResponse{Skills: out}, nil
}

type runnerSkillsOutput struct{ Body *SkillsResponse }

// RegisterInternalSkills registers the runner skills-pull operation on the
// internal S2S Huma API, scoped by construction to an execution id.
func RegisterInternalSkills(api huma.API, svc *SkillsService) {
	huma.Register(api, huma.Operation{
		OperationID: "runner-skills",
		Method:      http.MethodGet,
		Path:        "/internal/v1/executions/{executionId}/skills",
		Summary:     "Fetch the resolved skill bodies for an execution (runner callback)",
		Tags:        []string{"Internal"},
		Security:    auth.SecurityRunner,
	}, func(ctx context.Context, in *auth.ExecutionScopedInput) (*runnerSkillsOutput, error) {
		if svc == nil {
			return nil, huma.Error503ServiceUnavailable("skills endpoint not configured")
		}
		resp, err := svc.SkillsForExecution(ctx, in.OrgHandle, in.ExecutionID)
		if err != nil {
			if errors.Is(err, ErrExecutionNotFound) {
				return nil, huma.Error404NotFound("execution not found")
			}
			return nil, huma.Error500InternalServerError("failed to read skills")
		}
		return &runnerSkillsOutput{Body: resp}, nil
	})
}
