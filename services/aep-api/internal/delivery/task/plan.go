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
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/platform/taskplan"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// errNoBuildPlan is a Plan turn that completed without an ok planBuild. A
// milestone with no development issue settles at once as delivered, so this is
// a failed plan, never an empty one.
var errNoBuildPlan = errors.New("plan: the turn completed without a build plan")

// PlanService runs the version's Plan turn in the org's AE Studio pod and mints
// the build issue its last ok planBuild describes. One turn per project is the
// pod's lock: a different turn running is aestudiotools.ErrTurnInProgress,
// which the planning activity retries.
type PlanService struct {
	repos    sourcecontrol.ProjectRepoRows
	versions VersionReader
	turns    aestudiotools.Turns
	writer   *delivery.IssueWriter
}

// NewPlanService wires the plan service. turns runs the Plan turn in the org's
// pod; writer is the domain's issue-write surface the build issue is minted
// through.
func NewPlanService(repos sourcecontrol.ProjectRepoRows, versions VersionReader, turns aestudiotools.Turns, writer *delivery.IssueWriter) *PlanService {
	return &PlanService{repos: repos, versions: versions, turns: turns, writer: writer}
}

// PlanIntoMilestone plans the version's build and mints its one build issue
// into the milestone, with the `aep` working-set label, once the turn
// completes. A failed, silent or broken-off turn mints nothing, and so does a
// completed one with no ok planBuild (errNoBuildPlan).
//
// Pre-stream failures are typed: ErrProjectRepoNotFound, ErrNoSpecVersion,
// or the pod's (aestudiotools.ErrTurnInProgress, ErrAEStudioUnavailable,
// ErrAEStudioMisconfigured, ErrAEStudioAbsent, *StatusError).
func (s *PlanService) PlanIntoMilestone(ctx context.Context, orgID, projectID string, milestoneNumber int) error {
	// A row that is missing, or not provisioned yet, has nothing to plan in.
	ref, row, err := sourcecontrol.RepoRefFor(ctx, s.repos, orgID, projectID)
	if errors.Is(err, sourcecontrol.ErrRepoNotFound) || (err == nil && row.Status != "" && row.Status != "ready") {
		return ErrProjectRepoNotFound
	}
	if err != nil {
		return err
	}

	// Gate: a versioned (tagged) spec must exist (build-first). The tag is cut
	// by the build endpoint AFTER the whole-spec hard gate, so its presence
	// certifies a buildable requirements+design pair. A version is whatever
	// the user named it (ADR-0030), so membership is the tag's own annotation,
	// never the shape of its name. A read FAILURE is not an answer.
	versions, err := s.versions.ListSpecVersionTags(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("list spec versions: %w", err)
	}
	if versions == nil || versions.Latest == "" {
		return ErrNoSpecVersion
	}

	// What the version carries, from the tag. Best-effort: a scope-less read
	// plans the whole spec as one item.
	scope := spec.BuildScope{Tag: versions.Latest}
	if sc, serr := s.versions.BuildScopeAtTag(ctx, orgID, projectID, versions.Latest); serr == nil {
		scope = sc
		scope.Tag = versions.Latest
	} else {
		slog.WarnContext(ctx, "plan: scope read failed — planning the whole spec",
			"project", projectID, "tag", versions.Latest, "error", serr)
	}

	// The stream lives under ctx, so a cancelled activity stops reading (the
	// pod runs the turn on; a caller going away only detaches). The cancel is
	// also the tap's idle abort, and the deferred call releases the stream's
	// open response body whatever path returns.
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	// A fresh turn id per plan: a Plan is one-shot, never resumed. No credit:
	// no run row records who asked for the build (C7). The planner reads the
	// version's TAG, not main's tip (B2).
	events, err := s.turns.StartTurn(streamCtx, ref, aestudiotools.TurnRequest{
		TurnID:  uuid.NewString(),
		Project: projectID,
		Kind:    aestudiotools.TurnKindPlan,
		At:      "tags/" + versions.Latest,
		Scope:   planScopeFor(scope),
	})
	if err != nil {
		return err
	}

	tap := newPlanTap(ctx)
	if err := tap.Stream(events, cancel); err != nil {
		return err
	}
	if tap.plan == nil {
		return errNoBuildPlan
	}
	return s.mintBuildIssue(context.WithoutCancel(ctx), orgID, projectID, milestoneNumber, scope, tap.plan)
}

// mintBuildIssue files the version's build issue. The dedupe key makes a crash
// re-run of the plan find the open issue instead of filing a second one; a
// same-tag rebuild never plans (the milestone already holds a development
// issue). The write is detached from the caller's cancellation, so a mint in
// flight when the activity is cancelled still lands.
func (s *PlanService) mintBuildIssue(ctx context.Context, orgID, projectID string, milestoneNumber int, scope spec.BuildScope, plan *taskplan.BuildPlanOk) error {
	issue := scope.Issue(plan.Items)
	number, _, err := s.writer.Mint(ctx, orgID, projectID, delivery.IssueSpec{
		Title: issue.Title(),
		Body:  issue.Body(),
		// Armed, and PLANNED work: the kind keeps a bug-fix run off it. Gates
		// and the validation task are minted elsewhere.
		Labels:    []string{delivery.LabelAgentWork, delivery.KindDevelopment},
		Milestone: milestoneNumber,
		DedupeKey: delivery.DedupeKeyBuildIssue(projectID, milestoneNumber),
	})
	if err != nil {
		return fmt.Errorf("plan: mint the build issue for milestone %d: %w", milestoneNumber, err)
	}
	if number == 0 {
		return fmt.Errorf("plan: minting the build issue for milestone %d filed nothing", milestoneNumber)
	}
	return nil
}

// planScopeFor states what the version carries as facts the design agent
// renders: its features with what each is built after, its product-wide
// items, its held-back stories. Platform-computed — the model orders and
// annotates them, and never decides what is carried.
func planScopeFor(scope spec.BuildScope) *aestudiotools.PlanScope {
	out := &aestudiotools.PlanScope{Tag: scope.Tag, HeldBack: scope.HeldBack}
	for _, f := range scope.Features {
		out.Features = append(out.Features, aestudiotools.PlanFeature{ID: f.ID, Name: f.Name, Needs: f.Needs})
	}
	for _, it := range scope.ProductWide {
		out.ProductWide = append(out.ProductWide, aestudiotools.PlanItem{ID: it.ID, Text: strings.TrimSpace(it.Text), AppliesTo: it.AppliesTo})
	}
	return out
}
