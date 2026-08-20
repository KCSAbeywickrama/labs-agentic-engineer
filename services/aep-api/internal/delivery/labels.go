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

import "strings"

// The milestone-model label vocabulary. A milestone is one spec version's
// delivery increment AND its ledger, so the labels are what separate the
// populations living in it: the work each loop may pick up, the dispatch gates
// the platform must clear first, and the human-filed issues that are
// ledger-only until somebody arms them.
//
// It lives at the domain root because both halves of the loop read it — the
// event plane matching issues to a run, and the supervisor deciding a cycle
// boundary — and neither may import the other.
//
// Nothing here is parsed out of an issue BODY: bodies are prose. The labels
// plus milestone membership are the whole platform-side structure.
//
// TWO LABELS, TWO JOBS. An issue carries an ARMING SWITCH (`aep`) and a KIND
// (`development`, `bug`, `conflict`, `validation`, `provision`). The switch says
// a loop may work it at all; the kind says WHICH loop, and what the work is.
// Splitting them is what makes every routing predicate a POSITIVE membership
// test — "is this kind in my set" — instead of the set difference of two label
// unions the model used before, where every population was defined by what it
// was NOT and a single mis-stated exclusion emptied a live working set. ADR-0011
// records what that cost the last time it was got wrong.
const (
	// LabelAgentWork ("aep") is the ARMING SWITCH, and nothing more. An issue
	// carrying it may be picked up by a loop; an issue without it is ledger-only
	// — never worked, never stalling settle — whatever kind it also carries.
	//
	// It is also the GitHub-side ADOPTION trigger: a human stamping it on an
	// issue arms it, and the event plane starts (or wakes) a run over the
	// issue's milestone. Labels the platform stamps itself come back as webhook
	// echoes and are dropped by sender, so arming stays a human act.
	LabelAgentWork = "aep"
)

// The KINDS. Exactly one per issue — see KindOf for what happens when a human
// stamps two — and every issue the platform mints carries one.
//
// Kinds are DELIBERATELY unnamespaced words rather than `aep:*` markers: they
// are the vocabulary a human triaging the milestone already uses, and `bug` in
// particular is a label GitHub creates on every new repository. A human's
// pre-existing `bug` issue therefore reads as a bug to this platform the moment
// somebody arms it with `aep`, which is the behaviour we want; until then it is
// inert, because the arming switch is a separate label.
const (
	// KindDevelopment ("development") is planned work: what the planner mints
	// from the spec. It belongs to the DEV loop alone — a bug-fix run must never
	// pick up planned work for a version it is not building.
	KindDevelopment = "development"
	// KindBug ("bug") is a defect, from anywhere: a red build, a failed deploy,
	// a failed acceptance criterion, a wiring conformance defect, or a human.
	// Where it came from is the `src/*` source label, which only bugs carry.
	KindBug = "bug"
	// KindConflict ("conflict") is a cycle's pull request that will not merge.
	// The issue names the pull request so the agent rebases THAT branch rather
	// than opening a rival one.
	KindConflict = "conflict"
	// KindValidation ("validation") is the version's validation task: judge the
	// deployed system against its acceptance criteria. It is worked by the
	// validation loop, so it is excluded from both working sets — which is why
	// it may carry `aep` without ever holding a dev run's settle open.
	KindValidation = "validation"
	// KindProvision ("provision") is a dispatch HOLD: a dependency the platform,
	// not an agent, must resolve. It carries NO `aep` — nothing may work it —
	// and an open one holds the next dispatch without ever blocking settle.
	KindProvision = "provision"
)

// The SOURCES. Only a KindBug issue carries one, and its absence reads as
// SrcUser: a bug with no source label is a human's, because every platform
// minter stamps its own.
//
// The source is not a routing fact today — every bug is worked the same way —
// but it is what lets a run say WHY a version was re-opened, and it is the fact
// a validation task's reopen turns on (only a `src/validation` fix invalidates
// a recorded verdict).
const (
	SrcUser       = "src/user"
	SrcIncident   = "src/incident"
	SrcValidation = "src/validation"
	SrcBuild      = "src/build"
	SrcDeploy     = "src/deploy"
)

// The MARKERS. Orthogonal to kind: they qualify an issue the loop already
// routed, and an issue may carry any number of them.
const (
	// LabelCancelled ("aep:cancelled") marks an issue a cancel CLOSED while it
	// was still open. It is the rebuild's handle on "what was in flight": a
	// rebuild of an unchanged spec reopens exactly these and clears the label,
	// where work a cycle genuinely finished stays closed and unmarked.
	LabelCancelled = "aep:cancelled"
	// LabelHalted ("aep:halted") marks an issue a failed settle could not
	// finish, alongside a comment naming the terminal reason. The reconcile
	// sweep skips halted issues so a run that already gave up is not restarted
	// on the same work forever, with fresh budgets, which is what would defeat
	// every budget in the platform at once.
	//
	// The sweep applies it as a DECISION over issues it already fetched, never
	// as a query filter: "carries aep AND halted" is an intersection, and the
	// host's GraphQL label argument is a union that cannot express one. It
	// deliberately does not reach the cycle-boundary counts: a halted issue in a
	// LIVE run's milestone is a contradiction, because the run that halted them
	// is terminal by construction.
	//
	// Two things clear it, and both are somebody DECIDING the work is worth
	// another attempt — which is the decision the sweep must not make on its own:
	// a person removing the label, and the next build, which strips it from the
	// bugs it carries forward into the new version's milestone.
	LabelHalted = "aep:halted"
)

// kindPrecedence is the order KindOf resolves a multi-kind issue in.
//
// Exactly one kind per issue is an invariant the platform maintains — every
// minter stamps one, and the migration script produces one — so a second kind
// only ever arrives from a human hand-stamping a label. Rather than pick
// arbitrarily, the order is worst-consequence-first:
//
//   - provision wins outright. If an issue is a gate at all it is a platform
//     obligation, and dispatching an agent at it is the one outcome that puts an
//     agent on work it cannot do.
//   - validation next. It is the kind the milestone counts query subtracts from
//     the dev working set, so reading it as anything else would put this
//     function and the host's arithmetic on opposite sides of the one issue
//     whose exclusion the settle predicate rests on.
//   - conflict, then bug, then development. The recovery kinds name a budget and
//     an immediate obstruction; planned work is the weakest claim.
//
// A multi-kind issue is the ONLY case where this function and the counts query
// (githubhost.milestoneIssueCountsQuery) can disagree, because plain label
// subtraction cannot be reproduced by resolving to a single kind. Where they do,
// the disagreement costs a run that will not settle — visible, and recoverable —
// never a run that settles a version nobody built.
var kindPrecedence = []string{KindProvision, KindValidation, KindConflict, KindBug, KindDevelopment}

// KindOf returns the issue's kind, or "" when it carries none.
//
// "" is an honest answer and is reported as such — a ledger issue with no
// platform labels has no kind, and inventing one for it would put a kind chip on
// a human's note. The working-set predicates below are where the ARMED-but-
// kindless case is given a reading; see workKindOf.
func KindOf(labels []string) string {
	for _, kind := range kindPrecedence {
		if HasLabel(labels, kind) {
			return kind
		}
	}
	return ""
}

// SourceOf returns the `src/*` source of a bug, defaulting to SrcUser.
//
// The default is not a guess: every platform minter stamps its own source, so a
// bug that reached the milestone without one came from a human — which is
// exactly what SrcUser says.
//
// Nothing ROUTES on the answer. A source is provenance: it tells a human, and a
// coding agent reading the issue, who found the defect. The one place a source
// changes a platform decision is the task run's reopen rule, and that one reads
// the milestone's `src/validation` COUNT at the cycle boundary rather than each
// issue's labels — the boundary poll is the loop's hottest read and stays one
// round trip. So this is the vocabulary's single reader for everything else.
//
//deadcode:keep not yet called — the source vocabulary is read in one place or not at all, and this is that place; the routing rule that needs it reads a count instead.
func SourceOf(labels []string) string {
	for _, src := range []string{SrcIncident, SrcValidation, SrcBuild, SrcDeploy, SrcUser} {
		if HasLabel(labels, src) {
			return src
		}
	}
	return SrcUser
}

// workKindOf is the kind a WORKING-SET predicate reads: KindOf, with a kindless
// issue read as KindBug.
//
// The default matters for exactly one state — armed with `aep`, carrying no kind
// — which is what a human produces by stamping `aep` on a bare issue to adopt
// it, and what the platform's own history holds from before kinds existed. Two
// reasons it reads as a bug rather than as nothing:
//
//   - It is what the host's counts already say. The dev count is `aep` minus
//     `validation` and the task count subtracts `development` as well, so a
//     kindless armed issue lands in BOTH — exactly where KindBug puts it. The Go
//     predicates and the one GraphQL round trip must never disagree about what
//     work is; that disagreement is how a run settles a version nobody built.
//   - It is the safe direction. An issue wrongly counted as work stalls a run
//     visibly; an issue wrongly dropped from the working set closes a version
//     silently.
func workKindOf(labels []string) string {
	if kind := KindOf(labels); kind != "" {
		return kind
	}
	return KindBug
}

// InDevWorkingSet reports whether an issue belongs to a DEV run's working set:
// armed, and of a kind a build loop works — planned work, or a defect or
// conflict thrown up by working it.
//
// This is the set whose emptiness settles a version, so it is the predicate that
// must never quietly shrink. Compare sourcecontrol.MilestoneIssueCounts.
// OpenDevWork, which computes the same population as a COUNT in one host round
// trip; the two are separate implementations of one rule and are tested against
// each other.
func InDevWorkingSet(labels []string) bool {
	if !HasLabel(labels, LabelAgentWork) {
		return false
	}
	switch workKindOf(labels) {
	case KindDevelopment, KindBug, KindConflict:
		return true
	default:
		return false
	}
}

// InTaskWorkingSet reports whether an issue belongs to a TASK run's working set:
// armed, and a defect or a conflict. NEVER planned work.
//
// The exclusion of `development` is the whole point of the predicate, and it is
// not tidiness. Planned work is DEV-workflow's alone: a dev run owns the version
// and holds the project's build mutex, so leftover planned issues from a build
// that gave up must wait for another build rather than be continued by a run
// that never planned them and carries different budgets. A bug-fix run works the
// version already DEPLOYED; the planned work in front of it belongs to the
// version still being built.
//
// It sits beside InDevWorkingSet because two working-set rules written apart are
// two rules that drift, and it is checked against
// sourcecontrol.MilestoneIssueCounts.OpenTaskWork — the same rule as a COUNT —
// by TestWorkingSetsAgreeWithTheHostCounts.
func InTaskWorkingSet(labels []string) bool {
	if !HasLabel(labels, LabelAgentWork) {
		return false
	}
	switch workKindOf(labels) {
	case KindBug, KindConflict:
		return true
	default:
		return false
	}
}

// InWorkingSet reports whether an issue is in the working set of a run of this
// KIND — the one place the mapping from a run species to the population it works
// is written.
//
// A `validation` run answers false for everything, and that is a statement
// rather than a gap: it polls no working set at all (its work is the version's
// validation task, which it closes on every ending), and the repair issues a
// failed verdict files are deliberately somebody else's work — an ordinary task
// run's — so nothing a validation run leaves behind is unfinished work OF ITS
// OWN. The halt that stamps `aep:halted` on a failed run's leftovers reads this,
// which is why the distinction has to be stated here and not inferred.
//
// An unrecognised kind also answers false. The safe direction for THIS predicate
// is the empty set: its consumer marks issues as abandoned, so a wrong "yes"
// halts work nobody gave up on.
func InWorkingSet(runKind string, labels []string) bool {
	switch runKind {
	case RunKindDev:
		return InDevWorkingSet(labels)
	case RunKindTask:
		return InTaskWorkingSet(labels)
	default:
		return false
	}
}

// InCancelledWork reports whether a CANCEL of a run of this KIND closes the
// issue — the one place the mapping from a run species to the population its
// cancel suppresses is written, exactly as InWorkingSet is for the halt.
//
// It is a WIDER population than the working set for a dev run and a narrower one
// for the others, and the asymmetry is the whole statement cancel makes:
//
//	dev         EVERYTHING open in the milestone — the working set, the dispatch
//	            gates, the version's validation task and the ledger-only notes
//	            alike. A cancelled build ABANDONS the increment, so the milestone
//	            is closed behind it and nothing in it is anybody's work any more.
//	            The gates go too, which is the difference from a halt: a halted
//	            run may be retried in the same version, so its gates still name
//	            dependencies somebody must resolve.
//	task        the bugs and conflicts it was working. The version is NOT being
//	            abandoned — it is still the deployed one — so its milestone, its
//	            plan and its validation task are untouched.
//	validation  NOTHING. Its consequence is the version's validation task, and
//	            that close already happens on every ending (settleJudged), scoped
//	            to the task the run ADOPTED. Doing it from here would close a task
//	            a run cancelled before its first read never adopted, which is
//	            exactly the "leave it for the next trigger" case.
//
// Closing the issues is what makes a cancel STICK rather than merely record
// itself. The reconcile sweep starts a run for any open workable kind on a
// milestone with no live run, so an open issue left behind by a cancel is
// indistinguishable from work nobody started and the run is restarted within a
// tick. Suppression, not bookkeeping.
//
// The dev arm ignores the labels, and that is deliberate rather than a signature
// left over from the others: "every open issue" is the rule, and writing it as a
// predicate keeps the per-kind mapping in ONE readable place instead of splitting
// it between a predicate and an `if kind == dev` at the call site.
func InCancelledWork(runKind string, labels []string) bool {
	switch runKind {
	case RunKindDev:
		// Everything the increment was carrying — the working set and the
		// `provision` gates alike, and a bare ledger note with it, because the
		// milestone is being closed and leaving an open issue inside it is what
		// the sweep reads as unworked.
		//
		// EXCEPT the version's validation task. That is a handle on something
		// already DEPLOYED, and cancel reverts nothing: commits a cycle merged
		// stay on `main` and components it promoted keep serving. Closing it
		// would discard a pending judgement of software that is still running,
		// and the task is not this run's to abandon — a dev run mints one at
		// deployed-green and settles, so it only ever has one OPEN here when a
		// delivered-but-unjudged version was rebuilt and then cancelled.
		// Leaving it costs nothing: the sweep skips a cancelled increment, and a
		// later rebuild's dev run adopts the open task rather than filing a
		// second one.
		return !IsValidationWork(labels)
	case RunKindTask:
		return InTaskWorkingSet(labels)
	default:
		return false
	}
}

// CancelClosesTheMilestone reports whether a cancel of a run of this KIND
// abandons the INCREMENT — and therefore closes the version's milestone.
//
// Only a dev run's does. A build that was cancelled leaves a version nobody is
// shipping, and the way forward is the spec and another build; a task or
// validation run cancelled leaves the version exactly as deployed as it was, and
// closing its milestone would say the release had been withdrawn.
//
// It is a statement about the INCREMENT, never about what is running. Nothing is
// reverted by a cancel: commits a cycle merged stay on `main` and components it
// already promoted keep serving.
func CancelClosesTheMilestone(runKind string) bool { return runKind == RunKindDev }

// IsDispatchGate reports whether an issue is a dispatch hold. Note it does NOT
// test the arming switch: a gate carries none by construction, and reading a
// gate through `aep` is what would make it invisible to the predicate that
// holds dispatch on it.
func IsDispatchGate(labels []string) bool { return KindOf(labels) == KindProvision }

// IsValidationWork reports whether an issue is the version's validation task.
//
// Like IsDispatchGate this asks about the KIND alone. The validation task does
// carry `aep` — it is real agent work, just not a coding cycle's — and the
// arming switch is what lets the auto-merge policy admit its pull request
// without naming the kind twice.
func IsValidationWork(labels []string) bool { return KindOf(labels) == KindValidation }

// HasLabel reports whether labels contains name, case-insensitively (GitHub
// label matching is case-insensitive, and a hand-typed `AEP` must not read as
// a different population).
//
// Matching is EXACT string equality, never a prefix: an issue carrying a name
// this vocabulary has retired is invisible to every predicate above the instant
// the vocabulary changes, which is why a vocabulary change ships with the
// one-shot relabel in scripts/migrate-issue-labels.mjs.
func HasLabel(labels []string, name string) bool {
	for _, l := range labels {
		if strings.EqualFold(l, name) {
			return true
		}
	}
	return false
}
