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

package delivery

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// The label vocabulary is tested here rather than through the call sites
// because it is the one rule the whole loop routes on. A predicate that empties
// a working set does not fail loudly: it settles a version nobody built, and it
// does so on a live project (ADR-0011, "A lesson worth keeping").

// A milestone's issues, as label sets — the shape every case below is stated in,
// so no case can describe a population GitHub could not hold.
var (
	planned  = []string{LabelAgentWork, KindDevelopment}
	bug      = []string{LabelAgentWork, KindBug, SrcBuild}
	conflict = []string{LabelAgentWork, KindConflict}
	valid    = []string{LabelAgentWork, KindValidation}
	gate     = []string{KindProvision, "aep:dep/orders-db"}
	armed    = []string{LabelAgentWork} // a human armed it and classified nothing
	incident = []string{KindBug, SrcIncident}
	ledger   = []string(nil)
)

func TestKindOf(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		labels []string
		want   string
	}{
		{"planned work", planned, KindDevelopment},
		{"a bug", bug, KindBug},
		{"a conflict", conflict, KindConflict},
		{"the validation task", valid, KindValidation},
		{"a dispatch gate", gate, KindProvision},
		{"armed but unclassified", armed, ""},
		{"a ledger issue", ledger, ""},
		{"case-insensitive, as GitHub matches labels", []string{"AEP", "Development"}, KindDevelopment},
		// Multi-kind is a corruption a human hand-stamped, never a state the
		// platform mints. The order is fixed so the answer is at least the same
		// every time it is asked.
		{"provision outranks everything", []string{KindDevelopment, KindProvision}, KindProvision},
		{"validation outranks development", []string{KindDevelopment, KindValidation}, KindValidation},
		{"conflict outranks bug", []string{KindBug, KindConflict}, KindConflict},
		{"bug outranks development", []string{KindDevelopment, KindBug}, KindBug},
	}
	for _, c := range cases {
		if got := KindOf(c.labels); got != c.want {
			t.Errorf("KindOf(%s) = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestSourceOf(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		labels []string
		want   string
	}{
		{"a red build", bug, SrcBuild},
		{"a failed deploy", []string{LabelAgentWork, KindBug, SrcDeploy}, SrcDeploy},
		{"a failed criterion", []string{LabelAgentWork, KindBug, SrcValidation}, SrcValidation},
		{"a red main", incident, SrcIncident},
		// The default is not a guess: every platform minter stamps its own source,
		// so a bug that arrived without one came from a human.
		{"an unsourced bug is a human's", []string{LabelAgentWork, KindBug}, SrcUser},
		{"an explicit user source", []string{LabelAgentWork, KindBug, SrcUser}, SrcUser},
	}
	for _, c := range cases {
		if got := SourceOf(c.labels); got != c.want {
			t.Errorf("SourceOf(%s) = %q, want %q", c.name, got, c.want)
		}
	}
}

// TestWorkingSets pins what each loop may pick up. Every predicate is a POSITIVE
// membership test on a kind, which is the whole point of the vocabulary: the old
// model defined work by what it was NOT, and one mis-stated exclusion was enough
// to empty a live milestone.
func TestWorkingSets(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		labels   []string
		dev      bool
		task     bool
		gate     bool
		validate bool
	}{
		{"planned work is the dev loop's alone", planned, true, false, false, false},
		{"a bug is worked by both loops", bug, true, true, false, false},
		{"a conflict is worked by both loops", conflict, true, true, false, false},
		// Armed, because an agent IS dispatched at it and the platform must
		// auto-merge its pull request. In nobody's working set, because the
		// validation loop owns it and a working-set member would hold settle open.
		{"the validation task is nobody's working set", valid, false, false, false, true},
		// The case a naive "arm everything" would break. A gate carries no arming
		// label, so it is invisible to every working set — and the gate read is the
		// ONLY thing that can see it, which is what lets it hold dispatch.
		{"a gate is a hold, never work", gate, false, false, true, false},
		// Classification is not permission. A red-main incident is a bug so a human
		// can see what it is; nothing is dispatched at it until somebody arms it.
		{"an unarmed bug is ledger-only", incident, false, false, false, false},
		{"a bare human issue is ledger-only", ledger, false, false, false, false},
		// A human arming a bare issue is exactly this state. It reads as work to
		// both loops — the same answer the host's counts give for it, and the safe
		// direction: a stall is visible, a silent settle is not.
		{"armed but unclassified is work", armed, true, true, false, false},
	}
	for _, c := range cases {
		if got := InDevWorkingSet(c.labels); got != c.dev {
			t.Errorf("InDevWorkingSet(%s) = %v, want %v", c.name, got, c.dev)
		}
		if got := InTaskWorkingSet(c.labels); got != c.task {
			t.Errorf("InTaskWorkingSet(%s) = %v, want %v", c.name, got, c.task)
		}
		if got := IsDispatchGate(c.labels); got != c.gate {
			t.Errorf("IsDispatchGate(%s) = %v, want %v", c.name, got, c.gate)
		}
		if got := IsValidationWork(c.labels); got != c.validate {
			t.Errorf("IsValidationWork(%s) = %v, want %v", c.name, got, c.validate)
		}
	}
}

// hostCounts answers the populations the REAL host reports for a milestone
// holding these open issues: one label per field, exactly as the counts query
// filters one label per alias.
//
// It is spelled here as well as in sourcecontrol's own tests on purpose. The
// point of THIS copy is the comparison below — a fake that agreed with the
// arithmetic it was checking would prove nothing, so this one is written from
// the labels alone and never consults a predicate.
func hostCounts(issues ...[]string) *sourcecontrol.MilestoneIssueCounts {
	carrying := func(want string) int {
		n := 0
		for _, have := range issues {
			if HasLabel(have, want) {
				n++
			}
		}
		return n
	}
	return &sourcecontrol.MilestoneIssueCounts{
		OpenProvision:   carrying(KindProvision),
		OpenAgentWork:   carrying(LabelAgentWork),
		OpenDevelopment: carrying(KindDevelopment),
		OpenValidation:  carrying(KindValidation),
		OpenTotal:       len(issues),
	}
}

// TestWorkingSetsAgreeWithTheHostCounts is the most load-bearing test in this
// file. The working set is computed TWICE by design — once per issue from its
// own labels (InDevWorkingSet, which the planner, the wiring publisher and the
// task reads use) and once as a COUNT in a single GraphQL round trip
// (OpenDevWork, which the dispatch predicate and the settle check use) — because
// no host call can both count cheaply and hand back the labels.
//
// Two computations of one rule is how a loop learns two different things about
// the same milestone. So they are checked against each other over every
// population a milestone can hold, including the ones a milestone should never
// hold.
func TestWorkingSetsAgreeWithTheHostCounts(t *testing.T) {
	t.Parallel()
	milestones := [][][]string{
		{planned, planned, planned},
		{planned, gate},
		{planned, planned, gate, valid, ledger, ledger},
		{bug, conflict, valid},
		{ledger, ledger, incident},
		{armed, planned, bug},
		{valid},
		{gate, gate},
		{},
	}
	for _, milestone := range milestones {
		counts := hostCounts(milestone...)
		var dev, task, gates int
		for _, labels := range milestone {
			if InDevWorkingSet(labels) {
				dev++
			}
			if InTaskWorkingSet(labels) {
				task++
			}
			if IsDispatchGate(labels) {
				gates++
			}
		}
		if got := counts.OpenDevWork(); got != dev {
			t.Errorf("dev working set: counts say %d, labels say %d (milestone %v)", got, dev, milestone)
		}
		if got := counts.OpenTaskWork(); got != task {
			t.Errorf("task working set: counts say %d, labels say %d (milestone %v)", got, task, milestone)
		}
		if counts.OpenProvision != gates {
			t.Errorf("gates: counts say %d, labels say %d (milestone %v)", counts.OpenProvision, gates, milestone)
		}
	}
}

// TestDispatchable pins the ONE dispatch rule both halves of the loop read: the
// event plane, deciding whether a webhook is worth waking a waiting run for, and
// the supervisor, at every cycle boundary. They reach it from different shapes,
// so what they share is this function.
func TestDispatchable(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		work MilestoneWork
		want bool
	}{
		{"work and no gate", MilestoneWork{Gates: 0, Work: 1}, true},
		{"an open gate holds work back", MilestoneWork{Gates: 1, Work: 3}, false},
		// Not "some issue is open": a milestone holding only ledger issues has
		// nothing to work, and waking a run for it costs a cycle boundary that
		// finds an empty working set.
		{"nothing to work", MilestoneWork{Gates: 0, Work: 0}, false},
		{"a gate with nothing behind it holds nothing worth waking", MilestoneWork{Gates: 1, Work: 0}, false},
	}
	for _, c := range cases {
		if got := c.work.Dispatchable(); got != c.want {
			t.Errorf("Dispatchable(%s) = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestDispatchable_AGateHoldsWorkItDoesNotEraseIt is the live failure in one
// assertion pair, told from the counts a freshly planned milestone produces: one
// planned task and one open gate. The working set is ONE throughout — the gate
// holds the dispatch and releases it on close. Read as ZERO, the run settles a
// version nobody built.
func TestDispatchable_AGateHoldsWorkItDoesNotEraseIt(t *testing.T) {
	t.Parallel()
	gated := hostCounts(planned, gate)
	if got := gated.OpenDevWork(); got != 1 {
		t.Fatalf("working set behind the gate = %d, want 1 (counts %+v)", got, gated)
	}
	if (MilestoneWork{Gates: gated.OpenProvision, Work: gated.OpenDevWork()}).Dispatchable() {
		t.Fatal("an open gate must hold the dispatch")
	}
	released := hostCounts(planned)
	if got := released.OpenDevWork(); got != 1 {
		t.Fatalf("working set after the gate closed = %d, want 1", got)
	}
	if !(MilestoneWork{Gates: released.OpenProvision, Work: released.OpenDevWork()}).Dispatchable() {
		t.Fatal("the closed gate must release the task the milestone was holding")
	}
}
