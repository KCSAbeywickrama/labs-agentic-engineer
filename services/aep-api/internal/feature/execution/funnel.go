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

package execution

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/models"
)

// Funnel is THE single dispatch path (§5). Every intent — the aep:execute
// command label (webhook or the console Execute button, which stamps the same
// label), the reconciliation sweep, and build-success re-evaluation — flows
// through here; there is no imperative second door, so gates cannot be
// bypassed. Admission control is the executions partial unique index (TryAdmit),
// not the advisory gate check, so racing entrants (webhook ∥ sweep) never
// double-dispatch.
type Funnel struct {
	store    ExecutionStore
	issues   IssueClient
	repos    RepoLookup
	design   DesignReader
	registry *Registry
}

// NewFunnel wires the funnel. All dependencies are required.
func NewFunnel(store ExecutionStore, issues IssueClient, repos RepoLookup, design DesignReader, registry *Registry) *Funnel {
	return &Funnel{store: store, issues: issues, repos: repos, design: design, registry: registry}
}

// OnExecuteIntent handles an aep:execute command (§5): admit a coding Execution
// (the mutex), consume the label (best-effort projection), then run the gate
// check. Idempotent — a second intent while an Execution is active is a no-op
// (TryAdmit loses the race). A closed issue is not dispatched (§4).
func (f *Funnel) OnExecuteIntent(ctx context.Context, repoFullName string, issueNumber int) error {
	orgID, projectID, err := f.repos.ByFullName(ctx, repoFullName)
	if err != nil {
		return fmt.Errorf("resolve repo %q: %w", repoFullName, err)
	}
	view, err := f.loadProject(ctx, orgID, projectID, repoFullName)
	if err != nil {
		return err
	}
	facts, ok := view.byNumber[issueNumber]
	if !ok {
		// Not a Task (no marker) or not listable — the command is inert. Still
		// consume the label so a stray aep:execute does not linger.
		f.consumeExecute(ctx, orgID, projectID, issueNumber)
		return nil
	}
	if !facts.IssueOpen {
		// Closed = no new dispatches (§4). Consume the label.
		f.consumeExecute(ctx, orgID, projectID, issueNumber)
		return nil
	}

	// Retry semantics (§7 "retry = a new row of that kind"): if the latest coding
	// Execution succeeded into a MERGED PR whose latest build FAILED, an execute
	// intent retries the BUILD at the stored merge SHA (a new build row) rather
	// than re-running coding — this is what the console's Execute/Retry button
	// means for a build failure. Every other state (pending / failed-coding /
	// rejected) re-runs coding, unchanged.
	execs, err := f.store.LatestPerKind(ctx, facts.Repo, facts.IssueNumber)
	if err != nil {
		return fmt.Errorf("load executions for %s#%d: %w", facts.Repo, facts.IssueNumber, err)
	}
	if fb := failedMergedBuild(execs); fb != nil {
		return f.retryBuild(ctx, facts, fb.CommitSHA)
	}

	row := &models.Execution{
		OrgID:       facts.OrgID,
		ProjectID:   facts.ProjectID,
		Repo:        facts.Repo,
		IssueNumber: facts.IssueNumber,
		Kind:        string(taskmeta.KindCoding),
		Status:      string(taskmeta.ExecQueued),
		DesignTag:   facts.DesignTag,
		Component:   facts.Component,
	}
	admitted, adRow, err := f.store.TryAdmit(ctx, row)
	if err != nil {
		return fmt.Errorf("admit coding execution: %w", err)
	}
	// The label is a projection, never a lock (§5): consume it regardless of who
	// won the admission race.
	f.consumeExecute(ctx, orgID, projectID, issueNumber)
	if !admitted {
		return nil // an active Execution already holds the mutex
	}
	return f.gate(ctx, facts, adRow, view)
}

// Reevaluate re-runs the gate check on every queued coding Execution (§5): the
// path build-success and the sweep use to release Tasks whose dependencies just
// deployed, and to retry Tasks whose hold was lifted. Idempotent and safe to
// call concurrently — Start is guarded on the queued state.
func (f *Funnel) Reevaluate(ctx context.Context) error {
	active, err := f.store.ListActive(ctx)
	if err != nil {
		return fmt.Errorf("list active executions: %w", err)
	}
	// Cache the per-project Task view so a batch of queued rows in one project
	// lists its issues once.
	views := map[string]*projectView{}
	for i := range active {
		row := &active[i]
		if row.Status != string(taskmeta.ExecQueued) {
			continue
		}
		// Only coding and build rows queue behind gates; ops has no gate yet.
		if row.Kind != string(taskmeta.KindCoding) && row.Kind != string(taskmeta.KindBuild) {
			continue
		}
		key := row.OrgID + "/" + row.ProjectID
		view := views[key]
		if view == nil {
			v, verr := f.loadProject(ctx, row.OrgID, row.ProjectID, row.Repo)
			if verr != nil {
				slog.WarnContext(ctx, "funnel reevaluate: load project failed", "repo", row.Repo, "error", verr)
				continue
			}
			view, views[key] = v, v
		}
		facts, ok := view.byNumber[row.IssueNumber]
		if !ok || !facts.IssueOpen {
			// Issue removed or closed while queued → cancel the stale row.
			if _, ferr := f.store.Finish(ctx, row.ID, string(taskmeta.ExecCanceled), "task closed or removed"); ferr != nil {
				slog.WarnContext(ctx, "funnel reevaluate: cancel stale row failed", "id", row.ID, "error", ferr)
			}
			continue
		}
		// Build retries re-gate on hold only (a merged PR proceeds — no deps);
		// coding rows run the full gate. Both release when their gate clears.
		if row.Kind == string(taskmeta.KindBuild) {
			if gerr := f.dispatch(ctx, facts, row, "Build retry dispatch failed: "); gerr != nil {
				slog.WarnContext(ctx, "funnel reevaluate: build dispatch failed", "repo", row.Repo, "issue", row.IssueNumber, "error", gerr)
			}
			continue
		}
		if gerr := f.gate(ctx, facts, row, view); gerr != nil {
			slog.WarnContext(ctx, "funnel reevaluate: gate failed", "repo", row.Repo, "issue", row.IssueNumber, "error", gerr)
		}
	}
	return nil
}

// retryBuild admits a new build Execution for a failed-build Task and dispatches
// it at the stored merge SHA (§7 retry = new row). A build is not blocked by the
// dependency gate (a merged PR proceeds), but the hold command still applies.
func (f *Funnel) retryBuild(ctx context.Context, facts TaskFacts, mergeSHA string) error {
	row := &models.Execution{
		OrgID:       facts.OrgID,
		ProjectID:   facts.ProjectID,
		Repo:        facts.Repo,
		IssueNumber: facts.IssueNumber,
		Kind:        string(taskmeta.KindBuild),
		Status:      string(taskmeta.ExecQueued),
		DesignTag:   facts.DesignTag,
		Component:   facts.Component,
		CommitSHA:   mergeSHA,
	}
	admitted, adRow, err := f.store.TryAdmit(ctx, row)
	if err != nil {
		return fmt.Errorf("admit build retry: %w", err)
	}
	// The label is a projection, never a lock — consume it regardless.
	f.consumeExecute(ctx, facts.OrgID, facts.ProjectID, facts.IssueNumber)
	if !admitted {
		return nil // a build is already active for this Task
	}
	return f.dispatch(ctx, facts, adRow, "Build retry dispatch failed: ")
}

// dispatch runs an admitted queued row through the class executor: held →
// leave queued (released by the sweep / unhold via Reevaluate); no registered
// executor → cancel + attention; a run error → fail + attention (prefixed with
// attentionPrefix). Builds carry their pinned merge SHA in the row (coding rows
// carry none). Shared by retryBuild, Reevaluate, and the gate's dispatch tail.
func (f *Funnel) dispatch(ctx context.Context, facts TaskFacts, row *models.Execution, attentionPrefix string) error {
	if facts.HoldActive {
		return nil // queued behind the hold (§4/§5)
	}
	executor, ok := f.registry.Lookup(facts.Class)
	if !ok {
		f.flagAttention(ctx, facts, "No executor is registered for class "+string(facts.Class)+" yet.")
		_, _ = f.store.Finish(ctx, row.ID, string(taskmeta.ExecCanceled), reasonNoExecutor+" "+string(facts.Class))
		return nil
	}
	if err := executor.Run(ctx, DispatchRequest{Execution: row, Task: facts, MergeSHA: row.CommitSHA}); err != nil {
		f.flagAttention(ctx, facts, attentionPrefix+err.Error())
		_, _ = f.store.Finish(ctx, row.ID, string(taskmeta.ExecFailed), err.Error())
		return nil
	}
	return nil
}

// failedMergedBuild returns the latest build row when the Task is in the
// "merged PR, build failed" state a build retry recovers: the latest coding
// Execution succeeded (ended at PR-open) AND the latest build failed AND its
// merge SHA is recorded (needed to re-trigger). Otherwise nil (coding is the
// retry).
func failedMergedBuild(execs map[string]*models.Execution) *models.Execution {
	coding := execs[string(taskmeta.KindCoding)]
	build := execs[string(taskmeta.KindBuild)]
	if coding == nil || build == nil {
		return nil
	}
	if taskmeta.ExecutionStatus(coding.Status) != taskmeta.ExecSucceeded {
		return nil
	}
	if taskmeta.ExecutionStatus(build.Status) != taskmeta.ExecFailed || build.CommitSHA == "" {
		return nil
	}
	return build
}

// gate applies the advisory gate check to an admitted queued coding row and
// either dispatches it, leaves it queued (hold / unsatisfied deps / cycle), or
// cancels it (invalid class/component/no executor). The authoritative mutex is
// TryAdmit; gate never double-dispatches because Start is queued-guarded.
func (f *Funnel) gate(ctx context.Context, facts TaskFacts, row *models.Execution, view *projectView) error {
	// Class must be exactly one known class.
	if facts.Class == "" || !facts.Class.Valid() {
		f.flagAttention(ctx, facts, "This Task has no valid executor-class label (expected exactly one of aep:coding / aep:ops).")
		_, _ = f.store.Finish(ctx, row.ID, string(taskmeta.ExecCanceled), "missing or ambiguous executor class")
		return nil
	}
	// Coding Tasks are re-verified against the design at HEAD (§5).
	if facts.Class == taskmeta.ClassCoding {
		names, err := f.design.ComponentNames(ctx, facts.OrgID, facts.ProjectID)
		if err != nil {
			return fmt.Errorf("read design components: %w", err)
		}
		if names != nil && !names[strings.ToLower(facts.Component)] {
			f.flagAttention(ctx, facts, fmt.Sprintf("Component %q is no longer in the design — regenerate the design or close this Task.", facts.Component))
			_, _ = f.store.Finish(ctx, row.ID, string(taskmeta.ExecCanceled), "component not in design at HEAD")
			return nil
		}
	}
	// Hold stands while present — leave the row queued behind the gate (§4/§5).
	if facts.HoldActive {
		return nil
	}
	// Dependency gating (§5): every dependsOn component's latest Task must
	// derive deployed. A cycle can never satisfy, so it is flagged rather than
	// left indistinguishable from waiting.
	unmet, cycle := f.depsGate(ctx, facts, view)
	if len(cycle) > 0 {
		f.flagAttention(ctx, facts, "Dependency cycle detected: "+strings.Join(cycle, " → ")+". A human must break the cycle.")
		return nil
	}
	if len(unmet) > 0 {
		// Leave queued; the sweep / next build success re-evaluates.
		return nil
	}
	// Dispatch (the hold re-check inside is a no-op — held rows returned above).
	return f.dispatch(ctx, facts, row, "Dispatch failed: ")
}

// depsGate resolves the dependency gate for a Task. It returns the unmet
// dependency components (not yet deployed) and, if the component graph among the
// project's Tasks contains a cycle reachable from this Task's component, the
// cycle path. Deps are component names, never issue numbers (the phase-5 lesson).
func (f *Funnel) depsGate(ctx context.Context, facts TaskFacts, view *projectView) (unmet []string, cycle []string) {
	if facts.Component == "" {
		return nil, nil // ops Tasks carry operation, not component deps in v1
	}
	if cyc := detectCycle(facts.Component, view.latestByComponent); len(cyc) > 0 {
		return nil, cyc
	}
	for _, dep := range facts.DependsOn {
		depTask, ok := view.latestByComponent[strings.ToLower(dep)]
		if !ok {
			unmet = append(unmet, dep)
			continue
		}
		execs, err := f.store.LatestPerKind(ctx, depTask.Repo, depTask.IssueNumber)
		if err != nil {
			slog.WarnContext(ctx, "funnel deps: load dep executions failed", "dep", dep, "error", err)
			unmet = append(unmet, dep)
			continue
		}
		if deriveStatus(depTask, execs) != taskmeta.StatusDeployed {
			unmet = append(unmet, dep)
		}
	}
	return unmet, nil
}

// consumeExecute removes the edge-triggered aep:execute label (best-effort).
func (f *Funnel) consumeExecute(ctx context.Context, orgID, projectID string, number int) {
	if err := f.issues.RemoveLabel(ctx, orgID, projectID, number, taskmeta.LabelExecute); err != nil {
		slog.WarnContext(ctx, "funnel: consume aep:execute failed", "issue", number, "error", err)
	}
}

// flagAttention stamps aep:attention and posts a human-facing comment
// (best-effort). It is the funnel's escalation channel for states no automation
// can resolve (§4 attention).
func (f *Funnel) flagAttention(ctx context.Context, facts TaskFacts, msg string) {
	if err := f.issues.AddLabels(ctx, facts.OrgID, facts.ProjectID, facts.IssueNumber, []string{taskmeta.LabelAttention}); err != nil {
		slog.WarnContext(ctx, "funnel: add aep:attention failed", "issue", facts.IssueNumber, "error", err)
	}
	if err := f.issues.CommentIssue(ctx, facts.OrgID, facts.ProjectID, facts.IssueNumber, "⚠️ "+msg); err != nil {
		slog.WarnContext(ctx, "funnel: attention comment failed", "issue", facts.IssueNumber, "error", err)
	}
}

// projectView is the funnel's snapshot of a project's Tasks read live from
// GitHub: every Task issue by number, plus the latest Task per component
// (highest issue number wins — the same latest-per-component rule the agents
// service uses for cycle edges).
type projectView struct {
	byNumber          map[int]TaskFacts
	latestByComponent map[string]TaskFacts
}

// TaskFactsFor resolves one Task's live facts by repo full name + issue number
// (org/project resolved from the repo). ok is false when the issue is not a
// listable Task. The pull_request handlers use it to spawn builds with the
// merged Task's component + lineage.
func (f *Funnel) TaskFactsFor(ctx context.Context, repoFullName string, issueNumber int) (TaskFacts, bool, error) {
	orgID, projectID, err := f.repos.ByFullName(ctx, repoFullName)
	if err != nil {
		return TaskFacts{}, false, fmt.Errorf("resolve repo %q: %w", repoFullName, err)
	}
	view, err := f.loadProject(ctx, orgID, projectID, repoFullName)
	if err != nil {
		return TaskFacts{}, false, err
	}
	facts, ok := view.byNumber[issueNumber]
	return facts, ok, nil
}

// loadProject lists the project's aep:task issues once and indexes them.
func (f *Funnel) loadProject(ctx context.Context, orgID, projectID, repoFullName string) (*projectView, error) {
	issues, err := f.issues.ListIssues(ctx, orgID, projectID, []string{taskmeta.LabelMarker})
	if err != nil {
		return nil, fmt.Errorf("list task issues: %w", err)
	}
	v := &projectView{byNumber: map[int]TaskFacts{}, latestByComponent: map[string]TaskFacts{}}
	for _, issue := range issues {
		facts, _, ok := factsFromIssue(issue, orgID, projectID, repoFullName)
		if !ok {
			continue
		}
		v.byNumber[facts.IssueNumber] = facts
		if facts.Component != "" {
			key := strings.ToLower(facts.Component)
			if cur, exists := v.latestByComponent[key]; !exists || facts.IssueNumber > cur.IssueNumber {
				v.latestByComponent[key] = facts
			}
		}
	}
	return v, nil
}

// detectCycle reports the cycle path (component names) if the dependency graph
// among the latest-per-component Tasks contains a cycle reachable from start
// (self-dependency counts). Edges run component → each of its dependsOn.
func detectCycle(start string, latest map[string]TaskFacts) []string {
	start = strings.ToLower(start)
	visiting := map[string]bool{}
	var path []string
	var dfs func(node string) []string
	dfs = func(node string) []string {
		node = strings.ToLower(node)
		if visiting[node] {
			// Found a back-edge — return the cycle slice from node onward.
			for i, n := range path {
				if n == node {
					return append(append([]string{}, path[i:]...), node)
				}
			}
			return append(append([]string{}, path...), node)
		}
		task, ok := latest[node]
		if !ok {
			return nil
		}
		visiting[node] = true
		path = append(path, node)
		for _, dep := range task.DependsOn {
			if cyc := dfs(dep); len(cyc) > 0 {
				return cyc
			}
		}
		path = path[:len(path)-1]
		visiting[node] = false
		return nil
	}
	return dfs(start)
}
