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

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// The consumer ports the Task surface drives. Each is the narrow slice a service
// actually uses (the house pattern), so the composition root wires concrete
// providers and tests supply fakes.

// IssueClient is the GitHub issue surface the read path uses: list and fetch.
// sourcecontrol.IssueService satisfies it.
//
// It does NOT mint. The build issue is a platform mint like any other and goes
// through delivery.IssueWriter, so the `aep` label and the milestone assignment
// are decided in one place for the whole domain.
type IssueClient interface {
	ListIssues(ctx context.Context, orgID, projectID string, labels []string) ([]sourcecontrol.IssueInfo, error)
	// GetIssue fetches one issue by number (O(1)); returns sourcecontrol.ErrIssueNotFound
	// when it doesn't exist. Preferred over ListIssues when the number is known.
	GetIssue(ctx context.Context, orgID, projectID string, number int) (*sourcecontrol.IssueInfo, error)
	// ListIssueComments reads the newest `limit` comments of ONE issue, oldest
	// first. The detail read's counterpart to ListMilestoneIssueComments: a
	// detail page names its issue, so it needs no milestone to bound the fetch
	// and no bucketing to undo — which is what lets it answer for the validation
	// issue, the one issue the list read never projects.
	ListIssueComments(ctx context.Context, orgID, projectID string, number, limit int) ([]sourcecontrol.IssueComment, error)
	// ListMilestoneIssues reads one milestone's issues (pull requests excluded):
	// the milestone, not a label query, is the version's membership.
	ListMilestoneIssues(ctx context.Context, orgID, projectID string, filter sourcecontrol.MilestoneIssuesFilter) ([]sourcecontrol.IssueInfo, error)
	// ListMilestoneIssueComments reads the newest perIssue comments of every
	// issue in one milestone, bucketed by issue number and oldest first, in ONE
	// round trip. Milestone-scoped because that is the only bounded set of
	// issues this surface can name — see ListByTag.
	ListMilestoneIssueComments(ctx context.Context, orgID, projectID string, number, perIssue int) (map[int][]sourcecontrol.IssueComment, error)
}

// RepoResolver looks up the project's git repo row (its RepoURL yields the
// owner/name and repo full name the funnel/dispatcher key on).
type RepoResolver interface {
	GetRepo(ctx context.Context, orgID, projectID string) (*sourcecontrol.GitRepository, error)
}

// ComponentEnsurer idempotently provisions the OpenChoreo Component CR for a
// design component, erroring if no design component exists by that name.
// projects.ComponentService satisfies it. PromoteAndExecute calls it
// synchronously, so an unknown componentName (e.g. a caller's prefix-stripping
// bug) fails that call rather than surfacing later inside a cycle.
type ComponentEnsurer interface {
	EnsureComponent(ctx context.Context, orgID, projectID, componentName string) error
}

// VersionReader lists the project's spec versions and reads what one carries —
// the plan gate's build-first check and the plan's scope.
type VersionReader interface {
	// ListSpecVersionTags is the project's versions, newest first, with the
	// newest one named. A version is identified by its ANNOTATION, not by the
	// shape of its name (ADR-0030), so this is the only listing that sees a
	// version the user named — the retired `v<N>` scans did not.
	ListSpecVersionTags(ctx context.Context, orgID, projectID string) (*spec.TagList, error)
	// BuildScopeAtTag reads what a tag carries: the plan turn's scope and the
	// build issue's facts.
	BuildScopeAtTag(ctx context.Context, orgID, projectID, tag string) (spec.BuildScope, error)
}

// ExecutionReader is the read side of the executions rows (the platform-owned
// half), consumed org-scoped by the read path to fuse derived status. It is the
// delivery.ExecutionRepository scoped methods — the shared kernel, not the
// execution feature, so the §1 package boundary holds.
type ExecutionReader interface {
	LatestPerKindScoped(ctx context.Context, orgID, repo string, issueNumber int) (map[string]*delivery.Execution, error)
	LatestPerKindForRepoScoped(ctx context.Context, orgID, repo string) (map[int]map[string]*delivery.Execution, error)
	ListByIssueScoped(ctx context.Context, orgID, repo string, issueNumber int) ([]delivery.Execution, error)
}

// Adopter hands an issue to the coding agent: file it under the deployed
// version's milestone, arm it, and start an incident run over that milestone
// unless one is already live. *eventcore.Events satisfies it, wired at the
// composition root — this package names no sibling slice (the task ⊥ run arch
// lock). It refuses with one of delivery.AdoptionRefusal's sentinels an issue
// it will not take.
//
// The issue is read for its labels and state, and placed as if BARE (no
// milestone): its callers are the console's Issue card and the issue agent's
// hand-off, which hand over issues the platform has not placed.
type Adopter interface {
	AdoptIssue(ctx context.Context, orgID, projectID string, issueNumber int) error
}

// MilestoneResolver resolves a `?tag=<name>` query to the milestone NUMBER the
// version's Tasks live in, THROUGH THE PLATFORM'S RUN ROWS — never by matching
// titles against GitHub. delivery.MilestoneRunRepository satisfies it.
type MilestoneResolver interface {
	MilestoneNumberForTag(ctx context.Context, orgID, projectID, tag string) (number int, found bool, err error)
}
