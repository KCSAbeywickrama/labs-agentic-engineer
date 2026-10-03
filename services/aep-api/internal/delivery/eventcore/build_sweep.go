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
	"strconv"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// defaultBuildSweepInterval is how often terminal builds are observed.
//
// Matched to the supervisor's own buildPollInterval, and for the same reason it
// is not faster: a pass costs one ListPullRequestFiles call per live run against
// the org's GitHub credential, and the supervisor cannot act on what this sweep
// reports until its next poll anyway. Sweeping more often would only spend rate
// limit to shorten a wait nothing downstream can use.
const defaultBuildSweepInterval = time.Minute

// defaultReconcileGrace is how long after a cycle's merge the sweep leaves an
// unbuilt component to the merge's own delivery. It must outlast every run of
// that delivery — the receiver's and each replay's — because two fan-outs of
// one merge race on the org's clone credential; the composition root sets it
// from webhook.ReplayHorizon (see WithReconcileGrace), and this default matches
// what it sets.
const defaultReconcileGrace = 20 * time.Minute

// BuildSweep observes builds reaching a terminal state and reports each one to
// OnBuildTerminal, which owns what happens next (the automatic re-trigger, the
// fix issue, the signal to the supervisor).
//
// It exists because nothing else calls that observer for a run-loop build. The
// only other caller is the ExecWatcher, which sweeps `kind=build` execution
// rows — and the run loop records its cycles in run_cycles, not executions, so
// it mints none. Without this the whole build half of §8 row 4 was unreachable:
// a red build was never re-triggered, never minted a fix issue, and never told
// the supervisor, so the run polled a component that would never reach a
// verdict and hung until cancelled.
//
// State is DERIVED from OpenChoreo on every pass and never stored, matching the
// re-trigger budget's own rule: the WorkflowRuns are the record. That is what
// makes re-reporting safe, and re-reporting is unavoidable — a terminal run
// stays terminal, so every pass sees it again until the run advances.
//
// Idempotency rests on reporting ONLY the newest attempt, and only once it is
// itself terminal. After a red build is re-triggered the newest attempt is
// attempt 2, which is running, so the pass falls silent until that one settles.
// Reporting the older attempt again instead would spend the budget twice over
// and mint a fix issue while the retry was still in flight.
//
// It is also the RECONCILE for the merge fan-out, and has one trigger
// condition:
//
//	a live run's latest cycle has closed on a merge more than the reconcile
//	grace ago, and a component that merge touched has no build at its SHA,
//	gets that build.
//
// The fan-out is a webhook's work, and a delivery can be lost past every retry
// — the receiver's own run failed, its replays failed or ran out of window, or
// the delivery never arrived. Nothing else would notice: the supervisor's build
// stage has no deadline (awaitBuilds), so it waits on a build that was never
// triggered, forever. The sweep already reads exactly this cycle's component set
// and its builds, so the heal is the one branch it lacked — a component with no
// attempt at all — not a second walk.
//
// What keeps it from building what nobody wants:
//
//   - CANCEL: a run somebody asked to stop (CancelRequestedAt) is skipped, and a
//     cancelled run is terminal, so it is never walked.
//   - HALT: a halted run settled `failed`, which is terminal too.
//   - SUPERSEDE: only a live run's LATEST cycle is read, and builds are counted
//     per merge SHA, so an earlier cycle's merge or a superseded version's is
//     never built again.
//   - THE DELIVERY ITSELF: inside the grace a merge is still its delivery's to
//     build, and after it the heal goes through the same count-then-stage path
//     as the fan-out (buildMergedComponents), so a delivery that lands late
//     anyway finds the builds there and triggers and stages nothing.
type BuildSweep struct {
	events   *Events
	repos    RepoLister
	interval time.Duration
	grace    time.Duration
}

// NewBuildSweep wires the sweep. interval ≤ 0 uses the default.
func NewBuildSweep(events *Events, repos RepoLister, interval time.Duration) *BuildSweep {
	if interval <= 0 {
		interval = defaultBuildSweepInterval
	}
	return &BuildSweep{events: events, repos: repos, interval: interval, grace: defaultReconcileGrace}
}

// WithReconcileGrace sets how long after a merge an unbuilt component is left
// to the merge's own delivery. ≤ 0 keeps the default.
func (s *BuildSweep) WithReconcileGrace(grace time.Duration) *BuildSweep {
	if grace > 0 {
		s.grace = grace
	}
	return s
}

// Run ticks until ctx is cancelled (the app.Watcher shape).
func (s *BuildSweep) Run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.Once(ctx); err != nil {
				slog.WarnContext(ctx, "eventcore: build sweep failed", "error", err)
			}
		}
	}
}

// Once runs a single pass. Exported so a test can drive it directly.
//
// One repository's failure never stops the others, for the same reason the
// reconcile sweep works that way: this is the thing that still has to run when
// something else is broken.
func (s *BuildSweep) Once(ctx context.Context) error {
	if s.repos == nil || s.events == nil {
		return nil
	}
	e := s.events
	if e.p.Runs == nil || e.p.Builds == nil || e.p.PRs == nil || e.p.Design == nil {
		return nil
	}
	repos, err := s.repos.ListAll(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, repo := range repos {
		if rerr := s.sweepRepo(ctx, repo); rerr != nil {
			errs = append(errs, rerr)
		}
	}
	return errors.Join(errs...)
}

func (s *BuildSweep) sweepRepo(ctx context.Context, repo RepoRef) error {
	runs, err := s.events.p.Runs.LiveRunsForProject(ctx, repo.OrgID, repo.ProjectID)
	if err != nil {
		return err
	}
	var errs []error
	for i := range runs {
		if rerr := s.sweepRun(ctx, repo, &runs[i]); rerr != nil {
			errs = append(errs, rerr)
		}
	}
	return errors.Join(errs...)
}

// sweepRun observes the builds of one live run's current cycle.
//
// The component set is recomputed the same way the fan-out chose it — the
// merged pull request's files against the design's App Paths — because the
// observed set has to match the triggered set exactly. Deriving it from the
// WorkflowRuns instead would observe builds this cycle never triggered.
func (s *BuildSweep) sweepRun(ctx context.Context, repo RepoRef, run *delivery.MilestoneRun) error {
	e := s.events
	if e.p.Cycles == nil {
		return nil
	}
	cycle, err := e.p.Cycles.Latest(ctx, repo.OrgID, run.ID)
	if err != nil {
		return err
	}
	// No merge yet means no build yet: a cycle is only built once its pull
	// request lands, so there is nothing for this pass to observe.
	if cycle == nil || cycle.MergeSHA == "" || cycle.PRNumber == 0 {
		return nil
	}
	files, err := e.p.PRs.ListPullRequestFiles(ctx, repo.OrgID, repo.ProjectID, cycle.PRNumber)
	if err != nil {
		return err
	}
	paths, err := e.p.Design.ComponentPaths(ctx, repo.OrgID, repo.ProjectID)
	if err != nil {
		return err
	}
	var (
		errs    []error
		unbuilt []string
	)
	for _, component := range delivery.DiffComponents(files, paths).Components {
		built, cerr := s.observeComponent(ctx, repo, component, cycle.MergeSHA)
		if cerr != nil {
			errs = append(errs, cerr)
			continue
		}
		if !built {
			unbuilt = append(unbuilt, component)
		}
	}
	if len(unbuilt) > 0 && s.owedBuilds(run, cycle) {
		slog.WarnContext(ctx, "eventcore: build sweep found a merge whose builds were never triggered — building them",
			"project", repo.ProjectID, "run", run.ID, "pr", cycle.PRNumber,
			"merge", delivery.ShortSHA(cycle.MergeSHA), "components", unbuilt)
		if berr := e.buildMergedComponents(ctx, repo.OrgID, repo.ProjectID, run, cycle.MergeSHA, unbuilt); berr != nil {
			errs = append(errs, berr)
		}
	}
	return errors.Join(errs...)
}

// owedBuilds reports whether the reconcile may build for this cycle's merge: it
// closed on that merge more than the grace ago, and nobody asked the run to
// stop. The rest of the skip rules are the walk's own (live runs, latest cycle).
func (s *BuildSweep) owedBuilds(run *delivery.MilestoneRun, cycle *delivery.RunCycle) bool {
	if run.CancelRequestedAt != nil || cycle.EndedAt == nil {
		return false
	}
	return time.Since(*cycle.EndedAt) >= s.grace
}

// observeComponent reports the component's newest attempt at the merge SHA, if
// that attempt has finished. A still-running attempt is not news. built is
// false when the merge has no attempt for the component at all, which is the
// reconcile's cue.
func (s *BuildSweep) observeComponent(ctx context.Context, repo RepoRef, component, mergeSHA string) (built bool, err error) {
	e := s.events
	runs, err := e.p.Builds.ListBuildRuns(ctx, repo.OrgID, repo.ProjectID, component)
	if err != nil {
		return false, err
	}
	newest, ok := newestAttempt(runs, delivery.BuildRunNamePrefix(repo.ProjectID, component, mergeSHA))
	if !ok {
		return false, nil
	}
	if !newest.Completed {
		return true, nil
	}
	slog.DebugContext(ctx, "eventcore: build sweep observed a terminal build",
		"project", repo.ProjectID, "component", component,
		"merge", delivery.ShortSHA(mergeSHA), "run", newest.Name, "succeeded", newest.Succeeded)
	return true, e.OnBuildTerminal(ctx, delivery.BuildTerminal{
		OrgID:     repo.OrgID,
		ProjectID: repo.ProjectID,
		Component: component,
		CommitSHA: mergeSHA,
		RunName:   newest.Name,
		Succeeded: newest.Succeeded,
		Reason:    newest.Status,
	})
}

// newestAttempt picks the highest-ordinal run carrying the prefix. The ordinal
// rides the name — the same fact attemptsFor counts — so a run whose suffix is
// not a positive integer is not one of ours and is skipped rather than guessed
// at.
func newestAttempt(runs []BuildRun, prefix string) (BuildRun, bool) {
	var (
		best  BuildRun
		found bool
		high  int
	)
	for _, r := range runs {
		name := strings.ToLower(r.Name)
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		attempt, err := strconv.Atoi(name[len(prefix):])
		if err != nil || attempt <= 0 {
			continue
		}
		if !found || attempt > high {
			best, found, high = r, true, attempt
		}
	}
	return best, found
}
