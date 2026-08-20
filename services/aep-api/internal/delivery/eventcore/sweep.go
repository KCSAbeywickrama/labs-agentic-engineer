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
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// Why the sweep reads ISSUES where the cycle-boundary poll reads COUNTS.
//
// It makes two decisions a count cannot express, and both are intersections the
// host's union-valued GraphQL `labels:` argument cannot ask for. It must ROUTE by
// kind ("carries `aep` AND is of kind `validation`"), and it must SKIP the work a
// failed run gave up on ("carries `aep` AND `aep:halted`"). Both are therefore
// decided in Go over an UNFILTERED fetch, exactly as the auto-merge policy does
// and for the same stated reason: the fetch stays wide and the policy is the only
// place labels are read. Neither costs a round trip, and neither reintroduces a
// negative label query.
//
// It costs one REST call per known milestone per pass, replacing one GraphQL
// call. The boundary poll keeps its counts — that read runs at every cycle
// boundary and is the loop's hottest, and `aep:halted` deliberately does not
// reach it: a halted issue inside a LIVE run's milestone is a contradiction (the
// run that halted them is terminal by construction), so the hot poll is not
// complicated for a state it cannot see.

// defaultSweepInterval is the reconcile cadence. A backstop, not a driver:
// everything it heals is something a webhook should have done, so it is slow
// on purpose.
const defaultSweepInterval = 60 * time.Second

// Sweep is the reconcile backstop AND the trigger router, and it has TWO
// trigger conditions:
//
//	a milestone with open issues and no live run gets a run OF THE RIGHT KIND, and
//	a live run row past its planning phase is re-offered to the supervisor.
//
// The first heals both failure modes the event plane can have. A delivery
// GitHub never made (or that failed past its retries) leaves a milestone with
// work and nobody working it. And the adoption-versus-settle race — an issue
// joining a milestone in the instant the supervisor decided it was empty —
// leaves exactly the same footprint. It is also the ONLY thing that starts a
// validation run without a human asking: a dev run settles having filed the
// version's validation task, and this is what picks that task up.
//
// The second heals a failure mode the row model has: a live ROW is not a live
// WORKFLOW. Nothing else notices a row whose execution is gone, and because a
// non-terminal row answers LiveRunForMilestone forever, the first rule would
// skip it forever while the partial indexes refuse every later run on that
// project. Re-offering is idempotent — a running execution answers
// AlreadyStarted and the row is reused, not re-admitted — so the healthy case
// costs one Temporal call and changes nothing.
//
// Three things keep the first rule from resurrecting work nobody wants, and all
// three are somebody else's write:
//
//   - SUPERSEDE empties the previous version's milestone. It closes the planned
//     work and the gates (a plan is replaced by a plan) and MOVES the open bugs
//     into the new version's milestone (a defect is not superseded — it is still
//     broken, and the new version is what ships the fix). Either way the
//     superseded milestone holds no workable issue, so the trigger never fires on
//     it. A move that failed leaves one bug behind and a task run picks it up —
//     which is the right outcome for a defect, and the same best-effort posture a
//     failed close has always had.
//   - CANCEL is final. The increment is abandoned and the only way forward is the
//     next build.
//   - HALT marks what a FAILED run could not finish (`aep:halted`, see halt.go).
//     Without it this rule is a budget defeater: a run settles `failed` with its
//     working set still open, so the sweep starts a fresh run on the same issues
//     with fresh budgets, forever.
//
// It walks the milestones the PLATFORM knows (from its own run rows), not
// GitHub's milestone list: a milestone the platform never ran is not a missed
// delivery, it is somebody else's milestone. That is also what keeps the sweep
// inert on a project the platform has never run.
type Sweep struct {
	events   *Events
	repos    RepoLister
	interval time.Duration
}

// NewSweep wires the sweep. interval ≤ 0 uses the default.
func NewSweep(events *Events, repos RepoLister, interval time.Duration) *Sweep {
	if interval <= 0 {
		interval = defaultSweepInterval
	}
	return &Sweep{events: events, repos: repos, interval: interval}
}

// Run ticks until ctx is cancelled (the app.Watcher shape).
func (s *Sweep) Run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.Once(ctx); err != nil {
				slog.WarnContext(ctx, "eventcore: reconcile sweep failed", "error", err)
			}
		}
	}
}

// Once runs a single reconcile pass. Exported so the pass can be driven
// directly — by a test, and by anything that wants to reconcile now.
//
// One repository's failure never stops the others: the sweep's whole purpose
// is to be the thing that still runs when something else is broken.
func (s *Sweep) Once(ctx context.Context) error {
	if s.repos == nil || s.events == nil {
		return nil
	}
	repos, err := s.repos.ListAll(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, repo := range repos {
		if rerr := s.reconcileRepo(ctx, repo); rerr != nil {
			errs = append(errs, rerr)
		}
	}
	return errors.Join(errs...)
}

func (s *Sweep) reconcileRepo(ctx context.Context, repo RepoRef) error {
	e := s.events
	if e.p.Runs == nil || e.p.Issues == nil {
		return nil
	}
	milestones, err := e.p.Runs.KnownMilestones(ctx, repo.OrgID, repo.ProjectID)
	if err != nil {
		return err
	}
	var errs []error
	for _, milestone := range milestones {
		live, lerr := e.p.Runs.LiveRunForMilestone(ctx, repo.OrgID, repo.ProjectID, milestone.Number)
		if lerr != nil {
			errs = append(errs, lerr)
			continue
		}
		if live != nil {
			// A live ROW is not a live WORKFLOW. Re-offer it: StartRun is
			// idempotent — an execution that is running answers AlreadyStarted,
			// and the row is reused rather than re-admitted — so this costs one
			// Temporal call and heals a row whose workflow is gone. Without it a
			// non-terminal row answers LiveRunForMilestone forever, the sweep
			// skips it forever, and the partial indexes refuse every later run on
			// that project (the wedge migrate/milestone_runs.go:75-85 documents).
			//
			// EXCEPT a run still in its planning phase. Re-offering that one would
			// start a fresh workflow with no Tag and no provision inputs — the
			// caller's, not the row's — so it would skip planning entirely and
			// settle an unplanned version as delivered. A planning row is the
			// click's to resolve: it starts the workflow synchronously and settles
			// the row when it cannot.
			if live.State != delivery.RunStatePlanning {
				if serr := e.startRun(ctx, repo.OrgID, repo.ProjectID, milestone); serr != nil {
					errs = append(errs, serr)
				}
			}
			continue
		}
		issues, ierr := e.p.Issues.ListMilestoneIssues(ctx, repo.OrgID, repo.ProjectID,
			milestoneOpenIssuesFilter(milestone.Number))
		if ierr != nil {
			errs = append(errs, ierr)
			continue
		}
		if serr := e.offerRun(ctx, repo.OrgID, repo.ProjectID, milestone, issues); serr != nil {
			errs = append(errs, serr)
		}
	}
	return errors.Join(errs...)
}

// offerRun routes ONE unworked milestone: a validation run when the version's
// validation task is open, otherwise an ordinary task run when anything at all is
// open, and nothing when the milestone is quiet.
//
// Validation wins when both are open, and that ordering costs nothing in
// practice: a dev run files the validation task only at deployed-green, with the
// working set already empty, and a failed attempt's repair issues are filed after
// the task has been closed. The two coexist only when a human files work into a
// version awaiting its verdict, and judging first is the safe order there — the
// verdict is about what is deployed, which the new work has not changed yet.
//
// HALTED issues are dropped before either decision, and dropped rather than
// merely ignored: a milestone holding nothing but halted work is QUIET, and
// starting a run on it would park a supervisor on a milestone whose work nobody
// intends to finish. A newly filed issue in the same milestone is untouched by
// the filter and starts a run normally — halting marks the issues a run gave up
// on, never the milestone.
func (e *Events) offerRun(ctx context.Context, orgID, projectID string, milestone MilestoneRef,
	issues []sourcecontrol.IssueInfo) error {
	issues = notHalted(issues)
	if len(issues) == 0 {
		return nil
	}
	for _, iss := range issues {
		if delivery.HasLabel(iss.Labels, delivery.LabelAgentWork) && delivery.IsValidationWork(iss.Labels) {
			slog.InfoContext(ctx, "eventcore: reconcile sweep found an open validation task — judging the version",
				"project", projectID, "milestone", milestone.Number, "validationIssue", iss.Number)
			return e.startValidationRun(ctx, orgID, projectID, milestone)
		}
	}
	slog.InfoContext(ctx, "eventcore: reconcile sweep found unworked open issues — starting a run",
		"project", projectID, "milestone", milestone.Number, "openIssues", len(issues))
	return e.startRun(ctx, orgID, projectID, milestone)
}

// notHalted drops the issues a failed run marked `aep:halted`.
//
// It is a DECISION over issues the sweep already fetched, never a query filter,
// and that is the whole reason the fetch is unfiltered: "carries `aep` AND
// `aep:halted`" is an intersection the host cannot count, and its complement is a
// negative label query the host cannot express at all. Deciding here costs
// nothing and keeps every label rule in Go.
func notHalted(issues []sourcecontrol.IssueInfo) []sourcecontrol.IssueInfo {
	out := make([]sourcecontrol.IssueInfo, 0, len(issues))
	for _, iss := range issues {
		if delivery.HasLabel(iss.Labels, delivery.LabelHalted) {
			continue
		}
		out = append(out, iss)
	}
	return out
}
