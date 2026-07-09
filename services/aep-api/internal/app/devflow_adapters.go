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

package app

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"go.temporal.io/sdk/activity"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/design"
	"github.com/wso2/aep/aep-api/internal/feature/devflow"
	"github.com/wso2/aep/aep-api/internal/feature/genai"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/task"
	"github.com/wso2/aep/aep-api/repositories"
)

// repoFullNameLookup resolves a project's "owner/name" from the repo row —
// the devflow API's RepoLookup port.
type repoFullNameLookup struct {
	repos repositories.RepoRepository
}

func (l repoFullNameLookup) RepoFullName(ctx context.Context, orgID, projectID string) (string, error) {
	row, err := l.repos.GetByOrgAndProjectID(ctx, orgID, projectID)
	if err != nil {
		return "", err
	}
	if row == nil {
		return "", gitrepo.ErrRepoNotFound
	}
	owner, name, err := gitrepo.ParseOwnerRepo(row.RepoURL)
	if err != nil {
		return "", err
	}
	return owner + "/" + name, nil
}

// This file wires the devflow dev-workflow activity ports onto the existing
// artifacts / genai / plan services. The adapters live at the composition root
// so the devflow package imports none of those features (§6.8).

// devflowTagger cuts the requirements version tag via the artifacts service.
type devflowTagger struct {
	art artifacts.ArtifactService
}

func (t devflowTagger) CreateVersionTag(ctx context.Context, orgID, projectID string) (string, error) {
	res, err := t.art.SaveRequirements(ctx, orgID, projectID, artifacts.SaveRequest{Message: "Build: snapshot requirements"})
	if err != nil {
		return "", err
	}
	if res == nil {
		return "", nil
	}
	return res.Tag, nil
}

// devflowDesign adapts design existence + generation + approval onto the
// artifacts + genai + design services.
type devflowDesign struct {
	art    artifacts.ArtifactService
	genai  genai.GenAIService
	design design.DesignService
}

// designGenerateUseCase is the genai use case for the design-generate turn
// (mirrors genai's internal useCaseDesignGenerate).
const designGenerateUseCase = "design-generate"

func (d devflowDesign) DesignExists(ctx context.Context, orgID, projectID, reqTag string) (bool, error) {
	// A design tag for requirements v<N> has the form "v<N>-<M>"; a design
	// exists for reqTag iff the latest design tag is a revision of it.
	latest := d.art.LatestDesignTag(ctx, orgID, projectID)
	return latest != "" && strings.HasPrefix(latest, reqTag+"-"), nil
}

func (d devflowDesign) StartDesignTurn(ctx context.Context, orgID, projectID string) (string, error) {
	turnID, err := d.genai.StartTurn(ctx, orgID, projectID, genai.TurnInput{
		UseCase:        designGenerateUseCase,
		ConversationID: uuid.NewString(),
		Instruction:    "Generate the architecture design, wireframes, and OpenAPI specifications for this project.",
	})
	if err == nil {
		return turnID, nil
	}
	// A turn is already running for this project — reuse it (idempotent restart).
	var inProgress *genai.TurnInProgressError
	if errors.As(err, &inProgress) {
		return inProgress.ActiveTurnID, nil
	}
	return "", err
}

func (d devflowDesign) DesignTurnOutcome(ctx context.Context, orgID, projectID, turnID string) (bool, string, error) {
	st, err := d.genai.TurnStatus(ctx, orgID, projectID, turnID)
	if err != nil {
		return false, "", err
	}
	if st == nil {
		return false, "", nil
	}
	done := st.Status == "completed" || st.Status == "failed"
	return done, st.Status, nil
}

func (d devflowDesign) ApproveDesign(ctx context.Context, orgID, projectID string) error {
	// Empty commitSHA → SaveAndProceed reads + tags HEAD (the design the turn
	// just committed). Cuts the next v<N>-<M> design tag.
	_, err := d.design.SaveAndProceed(ctx, orgID, projectID, "")
	return err
}

// devflowPlanner runs the plan turn and reads back the planned tasks.
type devflowPlanner struct {
	plan  *task.PlanService
	reads *task.Reads
}

func (p devflowPlanner) RunPlan(ctx context.Context, orgID, projectID string) ([]devflow.PlannedTask, error) {
	session, err := p.plan.StartPlan(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	// Drain the plan turn to completion (the tap creates the issues as the
	// stream flows), heartbeating so Temporal does not time the activity out.
	session.Stream(heartbeatWriter{ctx: ctx}, func() {})

	// Read the tasks the plan just wrote back as the planned-task graph.
	views, err := p.reads.List(ctx, orgID, projectID, "open")
	if err != nil {
		return nil, err
	}
	out := make([]devflow.PlannedTask, 0, len(views))
	for _, v := range views {
		key := v.Component
		if key == "" {
			key = v.Operation
		}
		out = append(out, devflow.PlannedTask{
			Issue:     v.IssueNumber,
			Key:       key,
			DependsOn: v.DependsOn,
		})
	}
	return out, nil
}

// heartbeatWriter records a Temporal activity heartbeat on each write so a
// long plan turn does not exceed its heartbeat timeout. It discards the bytes
// (the plan tap does the real work; the workflow only needs the issue set).
type heartbeatWriter struct {
	ctx context.Context
}

func (w heartbeatWriter) Write(p []byte) (int, error) {
	activity.RecordHeartbeat(w.ctx, "plan streaming")
	return len(p), nil
}

// devflowValidator is the post-execution validation step (a stub for now — the
// real checks (all tasks closed, all deployments Ready) land as a follow-up).
type devflowValidator struct{}

func (devflowValidator) Validate(ctx context.Context, orgID, projectID, tag string) error {
	return nil
}
