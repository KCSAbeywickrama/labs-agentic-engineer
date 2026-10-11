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
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools"
	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools/aestudiotest"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// SERVICE tier for the plan path over the in-memory pod (aestudiotest.Fake):
// the Plan turn runs in the org's AE Studio pod, aep-api states what to plan
// and mints the build issue the pod's last task-op line describes.

type planVersions struct {
	specTag string
	scope   spec.BuildScope
}

func (p planVersions) ListSpecVersionTags(context.Context, string, string) (*spec.TagList, error) {
	if p.specTag == "" {
		return &spec.TagList{}, nil
	}
	return &spec.TagList{Tags: []string{p.specTag}, Latest: p.specTag}, nil
}

// BuildScopeAtTag answers the scope at the asked tag, as the real one does.
func (p planVersions) BuildScopeAtTag(_ context.Context, _, _, tag string) (spec.BuildScope, error) {
	scope := p.scope
	scope.Tag = tag
	return scope, nil
}

// planRig is a plan service over the fake pod, for project proj1 of org1
// whose repository is github.com/acme/widgets.
type planRig struct {
	pod    *aestudiotest.Fake
	issues *fakeIssues
	svc    *PlanService
}

// widgetsRef is proj1's repository as the plan service addresses it.
var widgetsRef = aestudiotools.RepoRef{Org: "org1", Owner: "acme", Repo: "widgets", DefaultBranch: "main"}

// newPlanRig seeds proj1's repository and, when versions names one, cuts the
// version's tag on it: the pod resolves the plan turn's `at` against it.
func newPlanRig(t *testing.T, versions planVersions) *planRig {
	t.Helper()
	pod := aestudiotest.New()
	pod.SeedRepo(widgetsRef, map[string]string{"specs/requirements/prd.md": "# PRD\n"})
	if versions.specTag != "" {
		if err := pod.Tag(context.Background(), widgetsRef, sourcecontrol.TagSpec{Name: versions.specTag, Message: "Spec " + versions.specTag}); err != nil {
			t.Fatal(err)
		}
	}
	issues := newFakeIssues()
	row := &sourcecontrol.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: "https://github.com/acme/widgets", Status: "ready"}
	svc := NewPlanService(fakeRepos{repo: row}, versions, pod, issues.writer())
	return &planRig{pod: pod, issues: issues, svc: svc}
}

// plan plans into milestone 7 and returns the one turn the pod saw. The pod
// answers with a one-item plan unless the test scripted another turn.
func (r *planRig) plan(t *testing.T) aestudiotest.TurnCall {
	t.Helper()
	if err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7); err != nil {
		t.Fatalf("PlanIntoMilestone: %v", err)
	}
	calls := r.pod.TurnCalls()
	if len(calls) != 1 {
		t.Fatalf("pod saw %d turns, want 1", len(calls))
	}
	return calls[0]
}

// scriptPlan makes every later turn answer with one ok planBuild of items.
func (r *planRig) scriptPlan(items ...string) { r.pod.ScriptTurn(taskOp(buildOK(items...))) }

// The Plan turn starts in the project's pod: kind plan, the project named,
// a fresh UUID turn id per plan, and no credit (no run records a requester).
func TestPlanMilestone_StartsAPlanTurnInThePod(t *testing.T) {
	r := newPlanRig(t, planVersions{specTag: "v1"})
	r.scriptPlan("spec")
	call := r.plan(t)

	if call.Ref != widgetsRef {
		t.Errorf("ref = %+v, want the project's repository in org1", call.Ref)
	}
	req := call.Request
	if req.Kind != aestudiotools.TurnKindPlan || req.Project != "proj1" {
		t.Errorf("request = %+v, want a plan turn for proj1", req)
	}
	if _, err := uuid.Parse(req.TurnID); err != nil {
		t.Errorf("turn id %q is not a UUID", req.TurnID)
	}
	if req.Credit != (aestudiotools.Credit{}) {
		t.Errorf("credit = %+v, want none (the run records no requester)", req.Credit)
	}
	if req.Scope == nil || req.Scope.Tag != "v1" || len(req.Scope.Features) != 0 {
		t.Errorf("scope = %+v, want the version's tag and no features for a scope-less read", req.Scope)
	}

	// A second plan is a second turn: plan turn ids are never reused.
	if err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7); err != nil {
		t.Fatal(err)
	}
	if calls := r.pod.TurnCalls(); calls[0].Request.TurnID == calls[1].Request.TurnID {
		t.Error("two plans shared a turn id")
	}
}

// The turn states what the version carries, and the last ok planBuild becomes
// ONE build issue: the checklist in order, the version's facts, the arming
// label and the development kind, the milestone and the version's dedupe key,
// all on the create call.
func TestPlanMilestone_TheLastPlanIsOneBuildIssue(t *testing.T) {
	r := newPlanRig(t, planVersions{specTag: "v2", scope: spec.BuildScope{
		Tag:         "v2",
		Features:    []spec.ScopeFeature{{ID: "F1", Name: "Claims"}, {ID: "F2", Name: "Approvals", Needs: []string{"F1"}}},
		ProductWide: []spec.ScopeItem{{ID: "P1", Text: "Sign in ", AppliesTo: []string{"all"}}},
		HeldBack:    []string{"F2.4"},
	}})
	r.pod.ScriptTurn(taskOp(buildOK("F1", "F2")), keepAlive, taskOp(buildOK("foundation", "F1", "F2")))

	scope := r.plan(t).Request.Scope
	if scope == nil || scope.Tag != "v2" || fmt.Sprint(scope.Features) != "[{F1 Claims []} {F2 Approvals [F1]}]" ||
		fmt.Sprint(scope.ProductWide) != "[{P1 Sign in [all]}]" || fmt.Sprint(scope.HeldBack) != "[F2.4]" {
		t.Fatalf("scope = %+v, want the version's features, product-wide items and held-back stories", scope)
	}

	if len(r.issues.created) != 1 {
		t.Fatalf("created %d issues, want the one build issue", len(r.issues.created))
	}
	c := r.issues.created[0]
	if c.Title != "Build v2" {
		t.Errorf("title = %q", c.Title)
	}
	if c.Milestone == nil || *c.Milestone != 7 {
		t.Errorf("milestone = %v, want 7", c.Milestone)
	}
	if fmt.Sprint(c.Labels) != fmt.Sprint([]string{delivery.LabelAgentWork, delivery.KindDevelopment}) {
		t.Errorf("labels = %v", c.Labels)
	}
	if c.DedupeKey != delivery.DedupeKeyBuildIssue("proj1", 7) {
		t.Errorf("dedupe key = %q", c.DedupeKey)
	}
	want := "Version `v2`: the spec is `specs/` at tag `v2`.\n\n" +
		"- [ ] **foundation** Shared setup and product-wide requirements: `order-service`. Build foundation.\n" +
		"- [ ] **F1** Claims: `order-service`. Build F1.\n" +
		"- [ ] **F2** Approvals: `order-service`. Build F2.\n" +
		"\nProduct-wide: P1\nHeld back: F2.4\n"
	if c.Body != want {
		t.Errorf("body:\n%s\nwant:\n%s", c.Body, want)
	}
}

// A completed turn that never planned is a failed plan: a milestone with no
// development issue would settle at once as delivered, having built nothing.
func TestPlanMilestone_ACompletedTurnWithNoPlanIsAnError(t *testing.T) {
	r := newPlanRig(t, planVersions{specTag: "v1"})
	r.pod.ScriptTurn(keepAlive)

	if err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7); !errors.Is(err, errNoBuildPlan) {
		t.Fatalf("err = %v, want errNoBuildPlan", err)
	}
	if len(r.issues.created) != 0 {
		t.Fatalf("created %d issues, want none", len(r.issues.created))
	}
}

// Build-first: no version, no plan, and nothing reaches the pod.
func TestPlanMilestone_RequiresAVersion(t *testing.T) {
	r := newPlanRig(t, planVersions{})
	if err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7); !errors.Is(err, ErrNoSpecVersion) {
		t.Fatalf("err = %v, want ErrNoSpecVersion", err)
	}
	if n := len(r.pod.TurnCalls()); n != 0 {
		t.Fatalf("pod saw %d turns, want none", n)
	}
}

// One turn per project is the pod's lock now: a different turn running is
// ErrTurnInProgress, which the planning activity retries.
func TestPlanMilestone_ATurnInProgressSurfaces(t *testing.T) {
	r := newPlanRig(t, planVersions{specTag: "v1"})
	r.pod.FailOp(aestudiotest.OpStartTurn, fmt.Errorf("%w (active turn x)", aestudiotools.ErrTurnInProgress))

	if err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7); !errors.Is(err, aestudiotools.ErrTurnInProgress) {
		t.Fatalf("err = %v, want ErrTurnInProgress", err)
	}
}

// A turn the pod ends failed is a failed plan, and mints nothing even when it
// had planned before failing.
func TestPlanMilestone_AFailedTurnIsAnError(t *testing.T) {
	r := newPlanRig(t, planVersions{specTag: "v1"})
	r.pod.ScriptTurn(taskOp(buildOK("spec")), aestudiotools.TurnEvent{Type: aestudiotools.EventResult, Status: "failed", Code: "agent-error"})

	if err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7); err == nil {
		t.Fatal("a failed plan turn returned no error")
	}
	if len(r.issues.created) != 0 {
		t.Fatalf("created %d issues, want none", len(r.issues.created))
	}
}

// The plan path settles the run it armed on a failed plan, so a mint that did
// not land has to surface as an ERROR rather than a warning.
func TestPlanMilestone_WriteFailureIsAnError(t *testing.T) {
	r := newPlanRig(t, planVersions{specTag: "v2"})
	r.issues.failCreate = true
	r.scriptPlan("spec")

	err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7)
	if err == nil {
		t.Fatal("a plan whose build issue was not minted must return an error")
	}
	if !strings.Contains(err.Error(), "milestone 7") {
		t.Errorf("error = %v, want it to name the milestone", err)
	}
}

// A version whose tag the repository does not have cannot be planned: the
// pod refuses the turn (404 ref_not_found) before it starts, and the refusal
// is permanent, so the planning activity does not retry it.
func TestPlanIntoMilestone_AnUnknownVersionTagIsPermanent(t *testing.T) {
	r := newPlanRig(t, planVersions{})
	r.svc = NewPlanService(fakeRepos{repo: &sourcecontrol.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: "https://github.com/acme/widgets", Status: "ready"}},
		planVersions{specTag: "v4"}, r.pod, r.issues.writer())
	err := r.svc.PlanIntoMilestone(context.Background(), "org1", "proj1", 7)
	if !errors.Is(err, sourcecontrol.ErrRefNotFound) || !sourcecontrol.IsPermanent(err) {
		t.Fatalf("err = %v, want a permanent ErrRefNotFound", err)
	}
	if n := len(r.pod.TurnCalls()); n != 0 {
		t.Fatalf("pod started %d turns, want none", n)
	}
}

// The plan turn reads the version it plans, not main's tip (B2): the turn
// names the version's tag as the commit the planner reads, so an edit made to
// the spec after the version was cut never reaches it.
func TestPlanIntoMilestone_ReadsTheVersionNotMain(t *testing.T) {
	r := newPlanRig(t, planVersions{specTag: "v3", scope: spec.BuildScope{Tag: "v3", Features: []spec.ScopeFeature{{ID: "F1"}}}})
	r.scriptPlan("F1")
	if req := r.plan(t).Request; req.At != "tags/v3" || req.Scope == nil || req.Scope.Tag != "v3" {
		t.Errorf("at = %q, scope = %+v, want tags/v3 with the v3 scope", req.At, req.Scope)
	}
}
