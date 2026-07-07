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

package taskmeta

// DerivedStatus is a Task's computed status (§4). It is never stored — the read
// path derives it from native GitHub facts joined with the latest Execution per
// kind, and StatusLabel projects it onto the issue for humans only.
type DerivedStatus string

const (
	StatusPending        DerivedStatus = "pending"
	StatusInProgress     DerivedStatus = "in_progress"
	StatusReadyForReview DerivedStatus = "ready_for_review"
	StatusMerged         DerivedStatus = "merged"
	StatusBuilding       DerivedStatus = "building"
	StatusDeployed       DerivedStatus = "deployed"
	StatusRejected       DerivedStatus = "rejected"
	StatusAbandoned      DerivedStatus = "abandoned"
	StatusFailed         DerivedStatus = "failed"
	StatusOnHold         DerivedStatus = "on_hold"
)

// PRState is the state of a Task's latest linked pull request; "" means no
// linked PR yet.
type PRState string

const (
	PRNone           PRState = ""
	PROpen           PRState = "open"
	PRMerged         PRState = "merged"
	PRClosedUnmerged PRState = "closed_unmerged"
)

// GitHubFacts is the native GitHub truth about a Task at derivation time: the
// issue's open/closed state, whether the hold command label is present, and the
// state of the latest linked PR. These are read live from GitHub (§8), never
// cached as a stored status.
type GitHubFacts struct {
	IssueOpen   bool
	HoldPresent bool
	PR          PRState // latest linked PR; PRNone when there is none
}

// Derive computes a Task's status from GitHub facts joined with its executions,
// first-match-wins in the precedence fixed by §4 (as amended 2026-07-04 during
// build):
//
//	on_hold
//	→ merged-group: deployed / building / failed / merged (PR merged)
//	→ deployed (a succeeded ops/provision gate — closed-on-success, §3.6)
//	→ abandoned
//	→ ready_for_review (PR open)
//	→ in_progress (active coding/ops Execution)
//	→ rejected (latest PR closed unmerged)
//	→ failed (latest Execution failed)
//	→ pending
//
// The precedence resolves the documented overlaps deliberately:
//   - a merged PR is irreversible, so it wins over a later issue-close
//     (the merged-group sits above abandoned);
//   - within the merged-group the LATEST build Execution decides: succeeded →
//     deployed, active → building, FAILED → failed (a merged PR whose build
//     failed must surface failed, or the §5 build-retry loop is invisible),
//     none/canceled → merged;
//   - a closed issue with an open PR derives abandoned (abandoned sits above the
//     PR review gate) — the closed issue stops new dispatches;
//   - an active retry beats a terminal closed-unmerged PR (in_progress sits
//     above rejected: a running retry is more actionable than the stale
//     rejection), while an open PR (ready_for_review) still sits above the
//     active retry, and a rejected PR still beats a merely FAILED retry.
//
// Chosen defaults (§13, revised): a canceled latest execution derives pending
// (a cancel is not a failure); a succeeded ops OR provision execution derives
// deployed (neither has a PR/build — a provision gate issue reaching deployed is
// how dependent coding tasks unblock, dependency-management §3.6); a succeeded
// coding execution with no linked PR yet derives pending (transient, between run
// end and PR link).
func Derive(f GitHubFacts, execs []ExecutionFact) DerivedStatus {
	// A held Task is on_hold regardless of anything else — hold is a command,
	// honored not derived.
	if f.HoldPresent {
		return StatusOnHold
	}

	// A merged PR is irreversible and wins over a later issue-close. The latest
	// build Execution refines it — including a failed build, which surfaces
	// failed so the retry loop is visible.
	if f.PR == PRMerged {
		if b := latestOfKind(execs, KindBuild); b != nil {
			switch {
			case b.Status == ExecSucceeded:
				return StatusDeployed
			case b.Status.IsActive():
				return StatusBuilding
			case b.Status == ExecFailed:
				return StatusFailed
			}
		}
		return StatusMerged
	}

	// A succeeded ops/provision Execution is a COMPLETED gate, not abandoned work:
	// the resolving aep:provision gate issue is CLOSED on success by the readiness
	// watcher / drawer action (§3.6 close-with-reference), so a closed issue backed
	// by a succeeded provision must derive deployed — this is exactly how dependent
	// coding tasks unblock. It therefore sits ABOVE the closed-without-merge =
	// abandoned rule (that rule targets coding Tasks, whose latest Execution is
	// coding, never ops/provision). Build Executions are excluded — a build's
	// terminal state is decided under the merged-PR arm above.
	if l := latestExcludingBuild(execs); l != nil && l.Status == ExecSucceeded &&
		(l.Kind == KindOps || l.Kind == KindProvision) {
		return StatusDeployed
	}

	// The issue was closed without a merge → the work was abandoned.
	if !f.IssueOpen {
		return StatusAbandoned
	}

	// An open PR is the review gate and sits above an active retry.
	if f.PR == PROpen {
		return StatusReadyForReview
	}

	// An active (queued/running) coding/ops Execution surfaces in_progress —
	// above a stale rejected PR (build is only meaningful post-merge, above).
	latest := latestExcludingBuild(execs)
	if latest != nil && latest.Status.IsActive() {
		return StatusInProgress
	}

	// A closed-unmerged PR is rejected — above a merely failed retry.
	if f.PR == PRClosedUnmerged {
		return StatusRejected
	}

	// Otherwise fall back to the latest Execution outcome. A succeeded
	// ops/provision already returned deployed above; a succeeded coding
	// execution with no linked PR yet is transient → pending.
	if latest != nil && latest.Status == ExecFailed {
		return StatusFailed
	}

	return StatusPending
}

// latestOfKind returns the most recently created Execution of the given kind,
// or nil when none exists.
func latestOfKind(execs []ExecutionFact, kind ExecutionKind) *ExecutionFact {
	var latest *ExecutionFact
	for i := range execs {
		if execs[i].Kind != kind {
			continue
		}
		if latest == nil || execs[i].CreatedAt.After(latest.CreatedAt) {
			latest = &execs[i]
		}
	}
	return latest
}

// latestExcludingBuild returns the most recently created non-build Execution
// (coding or ops), or nil when none exists.
func latestExcludingBuild(execs []ExecutionFact) *ExecutionFact {
	var latest *ExecutionFact
	for i := range execs {
		if execs[i].Kind == KindBuild {
			continue
		}
		if latest == nil || execs[i].CreatedAt.After(latest.CreatedAt) {
			latest = &execs[i]
		}
	}
	return latest
}
