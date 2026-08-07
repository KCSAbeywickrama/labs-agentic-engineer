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

// The build sweep is the ONLY thing that observes a run-loop build finishing:
// OnBuildTerminal's other caller sweeps `kind=build` execution rows, and the run
// loop records cycles in run_cycles instead, so it mints none. These tests drive
// Once directly against a fake OpenChoreo that remembers every run, so the
// re-trigger budget is counted against a growing run list exactly as in cluster.

func buildSweepOver(h *harness) *BuildSweep {
	return NewBuildSweep(h.events, fakeRepoLister{repos: []RepoRef{
		{OrgID: testOrg, ProjectID: testProject, FullName: testRepo},
	}}, 0)
}

// buildSweepHarness is a live run whose current cycle merged testMergeSHA and
// touched one component — the state a build terminal arrives in.
func buildSweepHarness(t *testing.T) *harness {
	t.Helper()
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	cycle := aCycle("cycle-1", "run-1")
	cycle.MergeSHA = testMergeSHA
	cycle.PRNumber = 42
	h.cycles.latest = cycle
	h.prs.files = []string{"services/order/main.go"}
	return h
}

// seedRun puts one attempt of a component's build into the fake cluster.
func seedRun(h *harness, component string, attempt int, completed, succeeded bool) {
	name := delivery.BuildRunName(testProject, component, testMergeSHA, attempt)
	status := "WorkflowRunning"
	if completed {
		status = "WorkflowFailed"
		if succeeded {
			status = "WorkflowSucceeded"
		}
	}
	h.builds.runs[component] = append(h.builds.runs[component], BuildRun{
		Name: name, Status: status, Completed: completed, Succeeded: succeeded,
	})
}

// TestBuildSweep_ReportsAGreenBuildToTheSupervisor is the path that lets a run
// advance at all.
func TestBuildSweep_ReportsAGreenBuildToTheSupervisor(t *testing.T) {
	h := buildSweepHarness(t)
	seedRun(h, "order-service", 1, true, true)

	if err := buildSweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("build sweep: %v", err)
	}
	sigs := h.sup.named(delivery.SigRunBuildTerminal)
	if len(sigs) != 1 || !sigs[0].Succeeded || sigs[0].Component != "order-service" {
		t.Fatalf("a terminal green build must reach the supervisor, got %+v", sigs)
	}
}

// TestBuildSweep_RedBuildSpendsTheAutomaticRetrigger is the regression this
// sweep exists for: a red build used to reach nobody, so the run polled a
// component that could never reach a verdict and hung until cancelled.
func TestBuildSweep_RedBuildSpendsTheAutomaticRetrigger(t *testing.T) {
	h := buildSweepHarness(t)
	seedRun(h, "order-service", 1, true, false)

	if err := buildSweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("build sweep: %v", err)
	}
	runs := h.builds.triggeredFor("order-service")
	if len(runs) != 1 || runs[0] != delivery.BuildRunName(testProject, "order-service", testMergeSHA, 2) {
		t.Fatalf("a red build must spend its one automatic re-trigger at the same SHA, got %v", runs)
	}
	if len(h.issues.created) != 0 {
		t.Fatalf("the first red mints no fix issue — the retry may still pass, got %v", h.issues.titles())
	}
}

// TestBuildSweep_DoesNotRereportWhileTheRetryIsInFlight is the idempotency
// property the whole design rests on. A terminal run stays terminal, so every
// pass sees attempt 1 again. Reporting it again would spend the budget twice and
// mint a fix issue while the retry was still running — so the sweep must read
// only the NEWEST attempt, which after a re-trigger is the one still in flight.
func TestBuildSweep_DoesNotRereportWhileTheRetryIsInFlight(t *testing.T) {
	h := buildSweepHarness(t)
	seedRun(h, "order-service", 1, true, false)
	sweep := buildSweepOver(h)

	if err := sweep.Once(t.Context()); err != nil {
		t.Fatalf("first pass: %v", err)
	}
	// The re-trigger appended attempt 2 as Running. Three more passes must be
	// silent: nothing new is terminal.
	for i := range 3 {
		if err := sweep.Once(t.Context()); err != nil {
			t.Fatalf("pass %d: %v", i+2, err)
		}
	}
	if runs := h.builds.triggeredFor("order-service"); len(runs) != 1 {
		t.Fatalf("re-running the sweep must not spend the budget again, got %v", runs)
	}
	if len(h.issues.created) != 0 {
		t.Fatalf("no fix issue may be minted while the retry is in flight, got %v", h.issues.titles())
	}
}

// TestBuildSweep_SecondRedMintsTheFixIssue closes the budget: once the retry has
// itself gone red the component has a verdict, and the run is told.
func TestBuildSweep_SecondRedMintsTheFixIssue(t *testing.T) {
	h := buildSweepHarness(t)
	seedRun(h, "order-service", 1, true, false)
	seedRun(h, "order-service", 2, true, false)

	if err := buildSweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("build sweep: %v", err)
	}
	if len(h.issues.created) != 1 {
		t.Fatalf("a spent budget must mint exactly one fix issue, got %v", h.issues.titles())
	}
	sigs := h.sup.named(delivery.SigRunBuildTerminal)
	if len(sigs) != 1 || sigs[0].Succeeded {
		t.Fatalf("the supervisor must be told the component is red, got %+v", sigs)
	}
}

// TestBuildSweep_SpentBudgetNeverRestagesTheCredential pins that a component
// whose budget is spent stops paying for staging.
//
// Reporting a terminal build is idempotent and repeats every pass for as long as
// the build stays terminal — which is forever, until the run advances. Staging
// is a destructive delete-then-create against the ONE per-org credential, so
// staging before consulting the budget would rewrite the live credential every
// minute on behalf of a build that will never be triggered again, and race any
// fan-out running concurrently in the same org.
func TestBuildSweep_SpentBudgetNeverRestagesTheCredential(t *testing.T) {
	h := buildSweepHarness(t)
	seedRun(h, "order-service", 1, true, false)
	seedRun(h, "order-service", 2, true, false) // budget already spent
	sweep := buildSweepOver(h)

	for i := range 3 {
		if err := sweep.Once(t.Context()); err != nil {
			t.Fatalf("pass %d: %v", i+1, err)
		}
	}
	if h.builds.staged != 0 {
		t.Fatalf("a component at budget must never re-stage the org credential, staged %d times", h.builds.staged)
	}
	if len(h.builds.triggered) != 0 {
		t.Fatalf("a spent budget triggers nothing, got %v", h.builds.triggered)
	}
}

// TestBuildSweep_IgnoresARunningBuild — a build still in flight is not news.
func TestBuildSweep_IgnoresARunningBuild(t *testing.T) {
	h := buildSweepHarness(t)
	seedRun(h, "order-service", 1, false, false)

	if err := buildSweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("build sweep: %v", err)
	}
	if sigs := h.sup.named(delivery.SigRunBuildTerminal); len(sigs) != 0 {
		t.Fatalf("a running build must be reported to nobody, got %+v", sigs)
	}
	if len(h.builds.triggered) != 0 {
		t.Fatalf("a running build must trigger nothing, got %v", h.builds.triggered)
	}
}

// TestBuildSweep_IgnoresACycleThatHasNotMerged — a cycle is only built once its
// pull request lands, so before that there is nothing to observe.
func TestBuildSweep_IgnoresACycleThatHasNotMerged(t *testing.T) {
	h := newHarness(t, aRun("run-1", 7, delivery.RunStateRunning))
	h.cycles.latest = aCycle("cycle-1", "run-1") // no MergeSHA, no PRNumber
	seedRun(h, "order-service", 1, true, false)

	if err := buildSweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("build sweep: %v", err)
	}
	if sigs := h.sup.named(delivery.SigRunBuildTerminal); len(sigs) != 0 {
		t.Fatalf("an unmerged cycle has no builds to observe, got %+v", sigs)
	}
}

// TestBuildSweep_ObservesOnlyWhatTheCycleTriggered pins the component set to the
// merged pull request's path diff rather than to whatever runs exist. Deriving
// it from the WorkflowRuns would observe builds this cycle never triggered.
func TestBuildSweep_ObservesOnlyWhatTheCycleTriggered(t *testing.T) {
	h := buildSweepHarness(t) // files touch services/order only
	seedRun(h, "order-service", 1, true, true)
	seedRun(h, "web", 1, true, true)

	if err := buildSweepOver(h).Once(t.Context()); err != nil {
		t.Fatalf("build sweep: %v", err)
	}
	sigs := h.sup.named(delivery.SigRunBuildTerminal)
	if len(sigs) != 1 || sigs[0].Component != "order-service" {
		t.Fatalf("only the components the merge touched may be observed, got %+v", sigs)
	}
}
