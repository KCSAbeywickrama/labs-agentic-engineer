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
	"log/slog"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// Lineage is the spec+design versions a Task was planned from (§2 lineage).
type Lineage struct {
	SpecTag   string `json:"specTag,omitempty"`
	DesignTag string `json:"designTag,omitempty"`
}

// ExecutionView is one Execution row projected for the API.
type ExecutionView struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	Status    string     `json:"status"`
	RunName   string     `json:"runName,omitempty"`
	Reason    string     `json:"reason,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	StartedAt *time.Time `json:"startedAt,omitempty"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

// TaskView is the list-item shape (§9.1): live GitHub facts fused with the
// latest Execution per kind into a derived status.
type TaskView struct {
	IssueNumber   int                      `json:"issueNumber"`
	Title         string                   `json:"title"`
	IssueURL      string                   `json:"issueUrl"`
	ExecutorClass string                   `json:"executorClass,omitempty"`
	Origin        string                   `json:"origin,omitempty"`
	Component     string                   `json:"component,omitempty"`
	Operation     string                   `json:"operation,omitempty"`
	DependsOn     []string                 `json:"dependsOn"`
	Rationale     string                   `json:"rationale,omitempty"`
	Body          string                   `json:"body,omitempty"`
	Lineage       Lineage                  `json:"lineage"`
	DerivedStatus string                   `json:"derivedStatus"`
	Hold          bool                     `json:"hold"`
	Attention     []string                 `json:"attention"`
	Executions    map[string]ExecutionView `json:"executions"`
}

// TaskDetail is the Get shape: a TaskView plus the full Execution history.
type TaskDetail struct {
	TaskView
	ExecutionHistory []ExecutionView `json:"executionHistory"`
}

// Reads is the live read path (§8): no cache, no read model.
type Reads struct {
	issues   IssueClient
	repos    RepoResolver
	execs    ExecutionReader
	versions VersionReader // optional (stale-design attention)
}

// NewReads wires the read path. versions may be nil (then the stale-design
// attention flag is not computed).
func NewReads(issues IssueClient, repos RepoResolver, execs ExecutionReader, versions VersionReader) *Reads {
	return &Reads{issues: issues, repos: repos, execs: execs, versions: versions}
}

// List returns the project's Tasks filtered by state ("open" | "closed" |
// "all"; default "open"). FE groups by derivedStatus client-side (§8).
func (r *Reads) List(ctx context.Context, orgID, projectID, state string) ([]TaskView, error) {
	repoFullName, err := resolveRepoFullName(ctx, r.repos, orgID, projectID)
	if err != nil {
		return nil, err
	}
	issues, err := r.issues.ListIssues(ctx, orgID, projectID, []string{taskmeta.LabelMarker})
	if err != nil {
		return nil, err
	}
	latestDesignTag := r.latestDesignTag(ctx, orgID, projectID)

	// One batch query for the whole repo's latest-per-kind rows (not one per
	// issue); a load failure degrades to empty executions, as before.
	execsByIssue, err := r.execs.LatestPerKindForRepoScoped(ctx, orgID, repoFullName)
	if err != nil {
		slog.WarnContext(ctx, "reads: load executions failed", "repo", repoFullName, "error", err)
		execsByIssue = map[int]map[string]*models.Execution{}
	}

	out := make([]TaskView, 0, len(issues))
	for _, issue := range issues {
		if !matchesState(issue.State, state) {
			continue
		}
		view, ok := buildView(issue, latestDesignTag, execsByIssue[issue.Number])
		if !ok {
			continue
		}
		out = append(out, view)
	}
	return out, nil
}

// Get returns one Task with its full Execution history.
func (r *Reads) Get(ctx context.Context, orgID, projectID string, issueNumber int) (*TaskDetail, error) {
	repoFullName, err := resolveRepoFullName(ctx, r.repos, orgID, projectID)
	if err != nil {
		return nil, err
	}
	issues, err := r.issues.ListIssues(ctx, orgID, projectID, []string{taskmeta.LabelMarker})
	if err != nil {
		return nil, err
	}
	var found *gitrepo.IssueInfo
	for i := range issues {
		if issues[i].Number == issueNumber {
			found = &issues[i]
			break
		}
	}
	if found == nil {
		return nil, ErrTaskNotFound
	}
	latestDesignTag := r.latestDesignTag(ctx, orgID, projectID)
	execs, err := r.execs.LatestPerKindScoped(ctx, orgID, repoFullName, issueNumber)
	if err != nil {
		slog.WarnContext(ctx, "reads: load executions failed", "issue", issueNumber, "error", err)
		execs = map[string]*models.Execution{}
	}
	view, ok := buildView(*found, latestDesignTag, execs)
	if !ok {
		return nil, ErrTaskNotFound
	}
	history, err := r.execs.ListByIssueScoped(ctx, orgID, repoFullName, issueNumber)
	if err != nil {
		return nil, err
	}
	hv := make([]ExecutionView, 0, len(history))
	for i := range history {
		hv = append(hv, executionView(&history[i]))
	}
	return &TaskDetail{TaskView: view, ExecutionHistory: hv}, nil
}

// buildView fuses one live issue with its latest-per-kind executions into a
// TaskView. ok is false when the issue is not a Task (no marker) — the caller
// skips it.
func buildView(issue gitrepo.IssueInfo, latestDesignTag string, execs map[string]*models.Execution) (TaskView, bool) {
	labels := taskmeta.ParseLabels(issue.Labels)
	if !labels.IsTask {
		return TaskView{}, false
	}
	block, human, blockErr := taskmeta.ParseBody(issue.Body)

	execFacts := repositories.ExecutionFacts(execs)
	facts := taskmeta.GitHubFacts{
		IssueOpen:   strings.EqualFold(issue.State, "open"),
		HoldPresent: labels.Hold,
		PR:          taskmeta.PRStateFromFacts(execFacts),
	}
	derived := taskmeta.Derive(facts, execFacts)

	view := TaskView{
		IssueNumber:   issue.Number,
		Title:         issue.Title,
		IssueURL:      issue.URL,
		ExecutorClass: string(labels.Class),
		Origin:        string(block.Origin),
		Component:     block.Component,
		Operation:     block.Operation,
		DependsOn:     nonNil(block.DependsOn),
		Rationale:     human.Rationale,
		Body:          human.Body,
		Lineage:       Lineage{SpecTag: block.SpecTag, DesignTag: block.DesignTag},
		DerivedStatus: string(derived),
		Hold:          labels.Hold,
		Attention:     computeAttention(labels, block, blockErr, latestDesignTag),
		Executions:    latestViews(execs),
	}
	return view, true
}

// computeAttention derives the standing attention flags for a Task: a mangled
// machine block, an ambiguous executor class, a stale lineage vs the current
// approved design, or a platform-set aep:attention with no more-specific reason.
func computeAttention(labels taskmeta.ParsedLabels, block taskmeta.Block, blockErr error, latestDesignTag string) []string {
	var flags []string
	if blockErr != nil && !errors.Is(blockErr, taskmeta.ErrNoBlock) {
		flags = append(flags, "mangled-block")
	}
	if labels.ClassAmbiguous {
		flags = append(flags, "ambiguous-class")
	}
	if latestDesignTag != "" && block.DesignTag != "" && block.DesignTag != latestDesignTag {
		flags = append(flags, "stale-design")
	}
	if labels.Attention && len(flags) == 0 {
		flags = append(flags, "flagged")
	}
	return flags
}

func latestViews(execs map[string]*models.Execution) map[string]ExecutionView {
	out := make(map[string]ExecutionView, len(execs))
	for kind, e := range execs {
		if e == nil {
			continue
		}
		out[kind] = executionView(e)
	}
	return out
}

func executionView(e *models.Execution) ExecutionView {
	return ExecutionView{
		ID:        e.ID,
		Kind:      e.Kind,
		Status:    e.Status,
		RunName:   e.RunName,
		Reason:    e.Reason,
		CreatedAt: e.CreatedAt,
		StartedAt: e.StartedAt,
		EndedAt:   e.EndedAt,
	}
}

// latestDesignTag returns the newest approved design tag (index 0 of the
// descending version list), or "" when unavailable. Best-effort — used only for
// the stale-design attention flag.
func (r *Reads) latestDesignTag(ctx context.Context, orgID, projectID string) string {
	if r.versions == nil {
		return ""
	}
	vs, err := r.versions.ListDesignVersions(ctx, orgID, projectID)
	if err != nil || len(vs) == 0 {
		return ""
	}
	return vs[0].Tag
}

func matchesState(issueState, filter string) bool {
	open := strings.EqualFold(issueState, "open")
	switch strings.ToLower(filter) {
	case "", "open":
		return open
	case "closed":
		return !open
	case "all":
		return true
	default:
		return open
	}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
