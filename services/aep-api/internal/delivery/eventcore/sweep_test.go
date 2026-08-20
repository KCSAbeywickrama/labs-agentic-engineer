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

package eventcore

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

func sweepOver(h *harness) *Sweep {
	return NewSweep(h.events, fakeRepoLister{repos: []RepoRef{
		{OrgID: testOrg, ProjectID: testProject, FullName: testRepo},
	}}, 0)
}

// TestSweep_StartsARunForUnworkedOpenIssues is the backstop's whole job: a
// milestone with open work and nobody on it. It heals a delivery GitHub never
// made and the adoption-versus-settle race, which leave the same footprint.
func TestSweep_StartsARunForUnworkedOpenIssues(t *testing.T) {
	h := newHarness(t, aRun("run-old", 7, delivery.RunStateSucceeded))
	h.issues.withCounts(7, 0, 2, 2)

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 1 || h.sup.started[0].MilestoneNumber != 7 ||
		h.sup.started[0].Kind != delivery.RunKindTask {
		t.Fatalf("the sweep must start a run over the unworked milestone, got %+v", h.sup.started)
	}
}

// TestSweep_ReOffersALiveRow is the wedge test.
//
// A live ROW is not a live WORKFLOW. Nothing else in the platform notices a row
// whose execution is gone, and because a non-terminal row makes
// LiveRunForMilestone answer forever, the sweep's open-work rule would skip it
// forever — while the partial unique indexes refuse every later run on that
// project. Re-offering is what heals it, and it is safe because StartRun is
// idempotent: a running execution answers AlreadyStarted and the row is reused
// rather than re-admitted.
//
// ZERO open issues is the case that matters. That is exactly what hasOpenWork
// skips, so a row stranded before its milestone was filled is the one the old
// rule could never reach.
func TestSweep_ReOffersALiveRow(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.issues.withCounts(7, 0, 0, 0)

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 1 || h.sup.started[0].MilestoneNumber != 7 {
		t.Fatalf("a live row must be re-offered so a lost workflow is restarted, got %+v", h.sup.started)
	}
	// A re-offer resumes a run; it must never re-derive the version.
	if h.sup.started[0].Tag != "" || len(h.sup.started[0].ProvisionInputs) != 0 {
		t.Errorf("a re-offer must carry no planning inputs, got %+v", h.sup.started[0])
	}
}

// TestSweep_NeverReOffersARunStillPlanning — the one live row the sweep must
// leave alone.
//
// Re-offering it would start a fresh workflow with no Tag and no provision
// inputs (those ride the request, not the row), so the run would skip its
// planning phase entirely and settle an UNPLANNED version as delivered. A
// planning row belongs to the click, which starts the workflow synchronously
// and settles the row when it cannot.
func TestSweep_NeverReOffersARunStillPlanning(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStatePlanning))
	h.issues.withCounts(7, 0, 0, 0)

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 0 {
		t.Fatalf("a run still planning must not be re-offered, got %+v", h.sup.started)
	}
}

// TestSweep_NeverResurrectsASupersededMilestone is the property that makes the
// backstop safe to run forever: supersede closes the previous version's open
// issues before the next milestone is minted, so an abandoned milestone has no
// open work for the sweep to find.
func TestSweep_NeverResurrectsASupersededMilestone(t *testing.T) {
	h := newHarness(t, aRun("run-old", 6, delivery.RunStateCancelled))
	h.issues.withCounts(6, 0, 0, 0) // superseded: everything closed

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 0 {
		t.Fatalf("an abandoned milestone holds no open work and must stay abandoned, got %+v", h.sup.started)
	}
}

// TestSweep_AnOpenGateDoesNotStopARunFromStarting — a gate holds DISPATCH, not
// the run. Healing into "started and waiting" is the correct repair.
func TestSweep_AnOpenGateDoesNotStopARunFromStarting(t *testing.T) {
	h := newHarness(t, aRun("run-old", 7, delivery.RunStateFailed))
	h.issues.withCounts(7, 1, 1, 2)

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 1 {
		t.Fatalf("a gated milestone with work still needs a run to wait on it, got %+v", h.sup.started)
	}
}

// TestSweep_IsInertWithoutRunRows — the same gate as every handler: the sweep
// walks the milestones the PLATFORM has run, so a project it has never run for
// is invisible to it.
func TestSweep_IsInertWithoutRunRows(t *testing.T) {
	h := newHarness(t)
	h.issues.withCounts(7, 0, 5, 5) // GitHub is full of open issues

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 0 {
		t.Fatalf("a milestone the platform never ran is somebody else's, got %+v", h.sup.started)
	}
}

// TestSweep_StartsAValidationRunForAnOpenValidationTask is the trigger the split
// created, and the only thing that turns a filed validation task into a verdict.
//
// A dev run settles at deployed-green having minted that task and never judges
// the version itself. Nothing else is watching: the task produces no webhook the
// platform reacts to, so if this pass did not route by KIND the version would sit
// deployed and unjudged forever with an open issue in its milestone.
func TestSweep_StartsAValidationRunForAnOpenValidationTask(t *testing.T) {
	h := newHarness(t, aRun("run-dev", 7, delivery.RunStateSucceeded))
	h.issues.withValidationIssue(7, 55)

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 1 {
		t.Fatalf("want one run started, got %+v", h.sup.started)
	}
	got := h.sup.started[0]
	if got.Kind != delivery.RunKindValidation {
		t.Fatalf("kind = %q, want %q — an open validation task is judged, not worked",
			got.Kind, delivery.RunKindValidation)
	}
	if got.MilestoneNumber != 7 {
		t.Fatalf("milestone = %d, want 7", got.MilestoneNumber)
	}
	// No attempt allowance rides the trigger: the per-version allowance is counted
	// from the ledger, so a sweep-started attempt cannot widen what a version is
	// allowed.
	if got.ValidationAttempts != 0 {
		t.Errorf("ValidationAttempts = %d, want 0 (the platform default)", got.ValidationAttempts)
	}
}

// The routing is by KIND, not by "something is open". Ordinary work still gets an
// ordinary run — the two must not collapse into one another, because a validation
// run has no working set and would judge a version whose work is unfinished.
func TestSweep_RoutesOrdinaryWorkToATaskRun(t *testing.T) {
	h := newHarness(t, aRun("run-old", 7, delivery.RunStateSucceeded))
	h.issues.withWork(7, 21, 22)

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 1 || h.sup.started[0].Kind != delivery.RunKindTask {
		t.Fatalf("open work must start a task run, got %+v", h.sup.started)
	}
}

// Validation wins when both populations are open, and the cost is nothing in
// practice: a dev run files the task only at deployed-green with the working set
// already empty, and a failed attempt's repair issues are filed after the task has
// been closed. They coexist only when a human files work into a version awaiting
// its verdict, and judging first is the safe order there — the verdict is about
// what is DEPLOYED, which the new work has not changed yet.
func TestSweep_ValidationTaskWinsOverOrdinaryWork(t *testing.T) {
	h := newHarness(t, aRun("run-old", 7, delivery.RunStateSucceeded))
	h.issues.withWork(7, 21).withValidationIssue(7, 55)

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 1 || h.sup.started[0].Kind != delivery.RunKindValidation {
		t.Fatalf("an open validation task must be judged first, got %+v", h.sup.started)
	}
}

// An UNARMED issue of kind `validation` is not a validation task — the arming
// switch is what says a loop may work it at all. Routing on the kind alone would
// let a human's stray label start a paid agent run.
func TestSweep_AnUnarmedValidationLabelIsNotATask(t *testing.T) {
	h := newHarness(t, aRun("run-old", 7, delivery.RunStateSucceeded))
	h.issues.withOpenIssues(7, []string{delivery.KindValidation})

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	// It is still an open issue, so a run is offered — as an ordinary one.
	if len(h.sup.started) != 1 || h.sup.started[0].Kind != delivery.RunKindTask {
		t.Fatalf("an unarmed validation label must not trigger a judgement, got %+v", h.sup.started)
	}
}

// A dispatch GATE is an open issue, so the sweep still starts a run for it: a gate
// holds DISPATCH, not the run, and healing into "started and waiting" is the
// correct repair. It must NOT be mistaken for a validation task.
func TestSweep_AGateAloneStartsAnOrdinaryRun(t *testing.T) {
	h := newHarness(t, aRun("run-old", 7, delivery.RunStateFailed))
	h.issues.withOpenIssues(7, []string{delivery.KindProvision})

	if err := sweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(h.sup.started) != 1 || h.sup.started[0].Kind != delivery.RunKindTask {
		t.Fatalf("a gated milestone still needs a run to wait on it, got %+v", h.sup.started)
	}
}
