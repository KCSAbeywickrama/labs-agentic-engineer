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
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/taskplan"
	"github.com/wso2/aep/aep-api/models"
)

// planInstruction is the steering directive the BFF composes server-side (§9.1:
// the request body is empty; the BFF assembles the whole generation directive).
const planInstruction = "Plan the implementation Tasks for this project. Load the task-planning skill and follow it: create one Task per design component with planTask, wire dependsOn by component name, and write each Task's body with updateTask in the same turn. The design is under specs/design/ and the requirements under specs/requirements/. Existing open Tasks (if any) are in tasks/*.md — update those that changed and add Tasks only for uncovered components. Never invent a component the design does not define."

// PlanService assembles the plan-turn context, starts the upstream turn, and
// hands back a PlanSession the HTTP edge streams. One active plan turn per
// project is enforced by an in-process in-flight set (§6) plus the upstream 409
// passthrough.
type PlanService struct {
	repos     RepoResolver
	design    DesignReader
	versions  VersionReader
	git       GitReader
	keys      AnthropicKeyResolver
	orgSkills OrgSkillSource
	client    TurnClient
	issues    IssueClient

	inflight sync.Map // projectKey → struct{}
}

// NewPlanService wires the plan service. orgSkills and git may be nil (then no
// auxiliary skills / no lineage diff).
func NewPlanService(repos RepoResolver, design DesignReader, versions VersionReader, git GitReader, keys AnthropicKeyResolver, orgSkills OrgSkillSource, client TurnClient, issues IssueClient) *PlanService {
	return &PlanService{repos: repos, design: design, versions: versions, git: git, keys: keys, orgSkills: orgSkills, client: client, issues: issues}
}

// PlanSession is a started plan turn: the raw upstream SSE body, the tap that
// executes tool frames against GitHub, and a release for the in-flight lock.
type PlanSession struct {
	body    io.ReadCloser
	tap     *planTap
	release func()
}

// Stream forwards the turn to w verbatim while the tap performs the GitHub
// writes, then releases the per-project in-flight lock. Survives client
// disconnect (the tap drains upstream).
func (s *PlanSession) Stream(w io.Writer, flush func()) {
	defer s.release()
	s.tap.Stream(s.body, w, flush)
}

// StartPlan assembles context and starts the plan turn. Pre-stream failures are
// typed errors (ErrNoApprovedDesign, ErrNoAnthropicKey, ErrProjectRepoNotFound,
// ErrPlanInProgress) or an *agentsvc.UpstreamError; on any pre-stream failure
// the in-flight lock is released before returning.
func (s *PlanService) StartPlan(ctx context.Context, orgID, projectID string) (*PlanSession, error) {
	key := orgID + "/" + projectID
	if _, loaded := s.inflight.LoadOrStore(key, struct{}{}); loaded {
		return nil, ErrPlanInProgress
	}
	release := func() { s.inflight.Delete(key) }
	session, err := s.startPlanLocked(ctx, orgID, projectID, release)
	if err != nil {
		release()
		return nil, err
	}
	return session, nil
}

func (s *PlanService) startPlanLocked(ctx context.Context, orgID, projectID string, release func()) (*PlanSession, error) {
	repo, owner, name, err := resolveProjectRepo(ctx, s.repos, orgID, projectID)
	if err != nil {
		return nil, err
	}

	// Gate: an approved (tagged) design version must exist (§6, approve-first).
	designVersions, err := s.versions.ListDesignVersions(ctx, orgID, projectID)
	if err != nil || len(designVersions) == 0 {
		return nil, ErrNoApprovedDesign
	}
	currentDesignTag := designVersions[0].Tag
	var currentSpecTag string
	if reqVersions, verr := s.versions.ListRequirementsVersions(ctx, orgID, projectID); verr == nil && len(reqVersions) > 0 {
		currentSpecTag = reqVersions[0].Tag
	}

	apiKey, err := s.keys(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("resolve anthropic key: %w", err)
	}
	if apiKey == "" {
		return nil, ErrNoAnthropicKey
	}

	// The artifact ports return paths RELATIVE to their spec roots (`design.md`,
	// `components/<name>/design.json`); the turn snapshot must carry the full
	// repo paths — the agent's known-components set is derived from the
	// `specs/design/components/<name>/` prefix (task-context.ts), so stripped
	// keys would make every planTask fail with UNKNOWN_COMPONENT.
	files := map[string]string{}
	if designFiles, derr := s.design.ListDesignFiles(ctx, orgID, projectID); derr == nil {
		for p, c := range designFiles {
			files["specs/design/"+p] = c
		}
	}
	if reqFiles, rerr := s.design.ListRequirements(ctx, orgID, projectID); rerr == nil {
		for p, c := range reqFiles {
			files["specs/requirements/"+p] = c
		}
	}

	// Existing open Tasks → read-only context files + tap preload + lineage diff.
	preload, existingKeys, olderTags := s.assembleExistingTasks(ctx, orgID, projectID, currentDesignTag, files)
	s.appendLineageDiffs(ctx, repo, owner, name, currentDesignTag, olderTags, files)
	// Freeze the set of issue numbers the agent actually received as context: an
	// updateTask{issueNumber} ref is fenced to it (a hallucinated / out-of-context
	// number must never be written — plan_tap.resolveRef).
	contextNumbers := make(map[int]bool, len(preload))
	for n := range preload {
		contextNumbers[n] = true
	}

	skills := []agentsvc.Skill{loadTaskPlanningSkill()}
	if s.orgSkills != nil {
		if aux, aerr := s.orgSkills(ctx, orgID); aerr == nil {
			skills = append(skills, aux...)
		} else {
			slog.WarnContext(ctx, "plan: org skills unavailable — proceeding without", "org", orgID, "error", aerr)
		}
	}

	// A fresh, namespaced conversation id per plan turn — plan turns are one-shot
	// (never rehydrated), so the id only needs to be unique within the tenant.
	conversationID := agentsvc.ConversationID(orgID, projectID, "task-plan",
		strconv.FormatInt(time.Now().UnixNano(), 10))

	// Detached context so the turn drains even if the client disconnects (§6).
	detached := context.WithoutCancel(ctx)
	body, err := s.client.Turn(detached, conversationID, orgID, apiKey, agentsvc.TurnRequest{
		Instruction: planInstruction,
		Files:       files,
		Skills:      skills,
		Toolset:     "task-plan",
	})
	if err != nil {
		return nil, err // typed *agentsvc.UpstreamError (409 → plan_in_progress passthrough)
	}

	tap := &planTap{
		ctx:            detached,
		orgID:          orgID,
		projectID:      projectID,
		specTag:        currentSpecTag,
		designTag:      currentDesignTag,
		issues:         s.issues,
		state:          preload,
		existingKeys:   existingKeys,
		contextNumbers: contextNumbers,
		titleToNumber:  map[string]int{},
		createdKeys:    map[string]bool{},
	}
	return &PlanSession{body: body, tap: tap, release: release}, nil
}

// assembleExistingTasks renders each open Task as a tasks/<n>.md context file
// (with machine-block facts), preloads the tap state for updateTask{issueNumber},
// collects the dedupe key set, and reports the distinct older design tags whose
// lineage diff the assembler should include (§6).
func (s *PlanService) assembleExistingTasks(ctx context.Context, orgID, projectID, currentDesignTag string, files map[string]string) (map[int]taskState, map[string]bool, map[string]bool) {
	preload := map[int]taskState{}
	existingKeys := map[string]bool{}
	olderTags := map[string]bool{}

	issues, err := s.issues.ListIssues(ctx, orgID, projectID, []string{taskmeta.LabelMarker})
	if err != nil {
		slog.WarnContext(ctx, "plan: list existing tasks failed", "error", err)
		return preload, existingKeys, olderTags
	}
	for _, issue := range issues {
		if !strings.EqualFold(issue.State, "open") {
			continue
		}
		block, human, berr := taskmeta.ParseBody(issue.Body)
		if berr != nil {
			continue // mangled/missing block — the events handler flags it
		}
		cf := taskplan.TaskContextFile{
			IssueNumber: issue.Number,
			Component:   block.Component,
			Title:       issue.Title,
			DependsOn:   block.DependsOn,
			Origin:      block.Origin,
			SpecTag:     block.SpecTag,
			DesignTag:   block.DesignTag,
			Body:        human.Body,
		}
		path, content := taskplan.RenderTaskContextFile(cf)
		files[path] = content

		preload[issue.Number] = taskState{block: block, human: human}
		if block.Key != "" {
			existingKeys[block.Key] = true
		}
		if block.DesignTag != "" && block.DesignTag != currentDesignTag {
			olderTags[block.DesignTag] = true
		}
	}
	return preload, existingKeys, olderTags
}

// appendLineageDiffs includes the spec/design delta between each older lineage
// tag and the current design tag so incremental planning reasons over the real
// change (§6 — GitHub compare, not the deleted DB diff machinery).
func (s *PlanService) appendLineageDiffs(ctx context.Context, repo *models.GitRepository, owner, name, currentDesignTag string, olderTags map[string]bool, files map[string]string) {
	if s.git == nil || len(olderTags) == 0 {
		return
	}
	cred, err := s.git.Resolver().Resolve(ctx, repo.OrgID)
	if err != nil {
		slog.WarnContext(ctx, "plan: resolve credential for lineage diff failed", "error", err)
		return
	}
	for oldTag := range olderTags {
		cmp, cerr := s.git.GitData().CompareRefs(ctx, owner, name, cred, oldTag, currentDesignTag)
		if cerr != nil {
			slog.WarnContext(ctx, "plan: lineage compare failed", "from", oldTag, "to", currentDesignTag, "error", cerr)
			continue
		}
		files["context/lineage-diff-"+oldTag+".md"] = renderCompare(oldTag, currentDesignTag, cmp)
	}
}

// renderCompare renders a compare result as a compact markdown summary for the
// planner's context (changed files + hunks).
func renderCompare(from, to string, cmp *gitrepo.CompareResult) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "# Lineage diff: %s → %s\n\n", from, to)
	fmt.Fprintf(&sb, "Status: %s (%d commit(s), +%d/-%d)\n\n", cmp.Status, cmp.TotalCommits, cmp.AheadBy, cmp.BehindBy)
	if cmp.Truncated {
		sb.WriteString("> NOTE: GitHub capped this compare at its file limit — the change list below is INCOMPLETE. Treat components not shown as possibly-changed and re-verify against the current design rather than assuming they are untouched.\n\n")
	}
	for _, f := range cmp.Files {
		fmt.Fprintf(&sb, "## %s (%s, +%d/-%d)\n", f.Filename, f.Status, f.Additions, f.Deletions)
		if f.Patch != "" {
			sb.WriteString("```diff\n")
			sb.WriteString(f.Patch)
			if !strings.HasSuffix(f.Patch, "\n") {
				sb.WriteByte('\n')
			}
			sb.WriteString("```\n")
		}
		sb.WriteByte('\n')
	}
	return sb.String()
}
