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
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// projectRunRowsStub answers the one read the run teardown makes. Every other
// verb of the repository is unreachable from it, so the embedded interface
// supplies them and any accidental call panics rather than passing silently.
type projectRunRowsStub struct {
	delivery.MilestoneRunRepository
	rows []delivery.MilestoneRun
	err  error
}

func (s projectRunRowsStub) ListByProject(context.Context, string, string) ([]delivery.MilestoneRun, error) {
	return s.rows, s.err
}

// recordingAbandoner records the milestones the teardown asked to abandon.
type recordingAbandoner struct {
	milestones []int
	err        error
}

func (r *recordingAbandoner) AbandonRun(_ context.Context, _, _ string, milestoneNumber int) error {
	r.milestones = append(r.milestones, milestoneNumber)
	return r.err
}

// TestAbandonProjectRuns_OneCallPerLiveMilestone: a run's identity is its
// milestone, so several rows of the same milestone name ONE supervisor — and a
// settled run has no supervisor left to end.
func TestAbandonProjectRuns_OneCallPerLiveMilestone(t *testing.T) {
	rows := []delivery.MilestoneRun{
		{MilestoneNumber: 2, State: delivery.RunStateRunning},
		{MilestoneNumber: 2, State: delivery.RunStateWaiting},   // same supervisor
		{MilestoneNumber: 1, State: delivery.RunStateSucceeded}, // already ended
		{MilestoneNumber: 3, State: delivery.RunStatePlanning},
		{MilestoneNumber: 4, State: delivery.RunStateCancelled}, // already ended
	}
	abandoner := &recordingAbandoner{}
	a := projectRunSupervision{runs: projectRunRowsStub{rows: rows}, supervisor: abandoner}

	if err := a.AbandonProjectRuns(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("AbandonProjectRuns: %v", err)
	}
	want := []int{2, 3}
	if len(abandoner.milestones) != len(want) {
		t.Fatalf("abandoned milestones = %v, want %v", abandoner.milestones, want)
	}
	for i := range want {
		if abandoner.milestones[i] != want[i] {
			t.Fatalf("abandoned milestones = %v, want %v", abandoner.milestones, want)
		}
	}
}

// TestAbandonProjectRuns_OneFailureDoesNotStopTheRest: this runs inside a delete
// that has already been committed upstream, so the most complete teardown
// possible beats a clean early return — every failure is still reported.
func TestAbandonProjectRuns_OneFailureDoesNotStopTheRest(t *testing.T) {
	rows := []delivery.MilestoneRun{
		{MilestoneNumber: 1, State: delivery.RunStateRunning},
		{MilestoneNumber: 2, State: delivery.RunStateWaiting},
	}
	boom := errors.New("temporal down")
	abandoner := &recordingAbandoner{err: boom}
	a := projectRunSupervision{runs: projectRunRowsStub{rows: rows}, supervisor: abandoner}

	err := a.AbandonProjectRuns(context.Background(), "acme", "web")
	if !errors.Is(err, boom) {
		t.Fatalf("AbandonProjectRuns error = %v, want it to carry %v", err, boom)
	}
	if len(abandoner.milestones) != 2 {
		t.Errorf("every live milestone must be attempted, got %v", abandoner.milestones)
	}
}

// TestAbandonProjectRuns_RowReadFailureIsReported: without the rows the teardown
// does not know which supervisors to end, and reporting nothing would read as
// "there were none".
func TestAbandonProjectRuns_RowReadFailureIsReported(t *testing.T) {
	boom := errors.New("db down")
	abandoner := &recordingAbandoner{}
	a := projectRunSupervision{runs: projectRunRowsStub{err: boom}, supervisor: abandoner}

	if err := a.AbandonProjectRuns(context.Background(), "acme", "web"); !errors.Is(err, boom) {
		t.Fatalf("AbandonProjectRuns error = %v, want %v", err, boom)
	}
	if len(abandoner.milestones) != 0 {
		t.Errorf("nothing may be abandoned on an unreadable index, got %v", abandoner.milestones)
	}
}

// ledgerRetireRecorder + cycleRunPurgeRecorder trace the delete cascade's three
// writes in the order the adapter issues them.
type cascadeTrace struct{ steps []string }

type ledgerRetireRecorder struct {
	delivery.AgentUsageLedgerRepository
	trace *cascadeTrace
	err   error
}

func (l *ledgerRetireRecorder) RetireByProject(context.Context, string, string) error {
	l.trace.steps = append(l.trace.steps, "retire")
	return l.err
}

type cyclePurgeRecorder struct {
	delivery.RunCycleRepository
	trace *cascadeTrace
}

func (c cyclePurgeRecorder) DeleteByProject(context.Context, string, string) error {
	c.trace.steps = append(c.trace.steps, "cycles")
	return nil
}

type runPurgeRecorder struct {
	delivery.MilestoneRunRepository
	trace *cascadeTrace
}

func (r runPurgeRecorder) DeleteByProject(context.Context, string, string) error {
	r.trace.steps = append(r.trace.steps, "runs")
	return nil
}

// TestProjectDelete_RetiresSpendBeforePurgingTheRowsItWasCapturedFrom.
//
// The cascade is two different verbs. Cycles and runs are working state and are
// deleted; what they COST is not, and is retired instead — which is what stopped
// a project delete from emptying the Settings → Usage page. Retirement goes
// first so a failure leaves the spend attributed to a live project (a retry
// fixes it) rather than the rows gone with their lifetime still open (nothing
// can).
func TestProjectDelete_RetiresSpendBeforePurgingTheRowsItWasCapturedFrom(t *testing.T) {
	trace := &cascadeTrace{}
	a := projectRunRows{
		runs:   runPurgeRecorder{trace: trace},
		cycles: cyclePurgeRecorder{trace: trace},
		ledger: &ledgerRetireRecorder{trace: trace},
	}
	if err := a.DeleteByProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("DeleteByProject: %v", err)
	}
	want := []string{"retire", "cycles", "runs"}
	if len(trace.steps) != len(want) {
		t.Fatalf("cascade = %v, want %v", trace.steps, want)
	}
	for i := range want {
		if trace.steps[i] != want[i] {
			t.Fatalf("cascade = %v, want %v", trace.steps, want)
		}
	}
}

// TestProjectDelete_AbortsWhenSpendCouldNotBeRetired: the rows must not be
// purged while the spend they carry is still attributed to a live project —
// that combination loses the record for good, which is the exact failure the
// ledger was added to stop.
func TestProjectDelete_AbortsWhenSpendCouldNotBeRetired(t *testing.T) {
	trace := &cascadeTrace{}
	boom := errors.New("db down")
	a := projectRunRows{
		runs:   runPurgeRecorder{trace: trace},
		cycles: cyclePurgeRecorder{trace: trace},
		ledger: &ledgerRetireRecorder{trace: trace, err: boom},
	}
	if err := a.DeleteByProject(context.Background(), "acme", "web"); !errors.Is(err, boom) {
		t.Fatalf("DeleteByProject error = %v, want %v", err, boom)
	}
	if len(trace.steps) != 1 {
		t.Fatalf("nothing may be purged after a failed retire: %v", trace.steps)
	}
}
