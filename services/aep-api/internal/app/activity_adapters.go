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
	"sync"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/activityvocab"
	"github.com/wso2/aep/aep-api/internal/delivery/devflow"
	"github.com/wso2/aep/aep-api/internal/platform/auth/jwtassertion"
	"github.com/wso2/aep/aep-api/internal/projects"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// This file wires the activity-feed producers (issue #239) onto the projects
// domain's activity service. Two adapters, both app-root twins-mappers:
// delivery (devflow + the build handler) must not import projects — projects
// already imports delivery — so each side speaks its own type and the mapping
// lives here.

// devflowActivityRecorder maps devflow's RecordedActivity twin onto
// projects.ActivityInput and appends it (best-effort — the service swallows
// storage errors).
type devflowActivityRecorder struct{ svc *projects.ActivityService }

func (r devflowActivityRecorder) Record(ctx context.Context, e devflow.RecordedActivity) {
	r.svc.Record(ctx, projects.ActivityInput{
		OrgID:      e.OrgID,
		ProjectID:  e.ProjectID,
		Type:       e.Type,
		ActorKind:  e.ActorKind,
		ActorID:    e.ActorID,
		ActorName:  e.ActorName,
		Issue:      e.Issue,
		Title:      e.Title,
		Component:  e.Component,
		Tag:        e.Tag,
		DedupKey:   e.DedupKey,
		OccurredAt: e.OccurredAt,
	})
}

// buildActivityRecorder implements build.SpecPublishedRecorder: the user
// published a spec version and kicked off the build. Actor = the signed-in
// user (email id → the console renders "You" for the author).
type buildActivityRecorder struct{ svc *projects.ActivityService }

func (r buildActivityRecorder) RecordSpecPublished(ctx context.Context, orgID, projectName, tag string) {
	email, name := userIdentityFromContext(ctx)
	r.svc.Record(ctx, projects.ActivityInput{
		OrgID:      orgID,
		ProjectID:  projectName,
		Type:       activityvocab.TypeSpecPublished,
		ActorKind:  activityvocab.ActorUser,
		ActorID:    email,
		ActorName:  name,
		Tag:        tag,
		DedupKey:   "spec:" + projectName + ":" + tag + ":published",
		OccurredAt: time.Now().UTC(),
	})
}

// specAuthorship bridges the async gap between a room-scoped genai turn
// finishing and the collab committer later flushing that turn's doc edits to git
// (issue #239). A room turn writes into the shared doc and commits nothing; the
// committer flushes ~a debounce-window later via files/apply, under the user's
// own token — so at the git layer the agent's work is indistinguishable from a
// manual edit and would be mis-attributed to the user. The turn is the only
// place agent authorship is still known, so it marks the project here; the next
// apply that lands a commit claims the mark and suppresses its (wrong) user
// line, because the turn already recorded the agent line.
//
// A boolean per (org, project) is precise for the common cases: agent-only edit
// (mark set → claimed → no user line), user-only edit (no mark → user line),
// and agent-then-user within one flush (attributed to the agent). The state is
// in-process, matching the single aep-api replica of the deployment; a restart
// between a turn and its flush at worst mislabels that one flush as manual.
type specAuthorship struct{ pending sync.Map } // key: orgID + "\x00" + projectID

func specKey(orgID, projectID string) string { return orgID + "\x00" + projectID }

// markAgent records that an agent turn authored uncommitted spec edits for this
// project.
func (a *specAuthorship) markAgent(orgID, projectID string) {
	a.pending.Store(specKey(orgID, projectID), struct{}{})
}

// claimAgent reports whether an agent authored the change now being committed,
// consuming the mark so a later manual edit is not swept up by it.
func (a *specAuthorship) claimAgent(orgID, projectID string) bool {
	_, ok := a.pending.LoadAndDelete(specKey(orgID, projectID))
	return ok
}

// filesActivityRecorder implements files.SpecUpdatedRecorder: an apply landed a
// real commit, so the project's spec changed. This is the path the collab
// session flush and the spec editor's save share. A flush that carries an agent
// turn's doc edits is already on the feed as the agent (recorded at turn
// finish), so it is suppressed here; a genuine manual edit falls through and is
// attributed to the signed-in user. Deduped by commit sha.
type filesActivityRecorder struct {
	svc        *projects.ActivityService
	authorship *specAuthorship
}

func (r filesActivityRecorder) RecordSpecUpdated(ctx context.Context, orgID, projectName, commitSHA string) {
	if r.authorship.claimAgent(orgID, projectName) {
		return // agent-authored — the turn already recorded the agent line.
	}
	email, name := userIdentityFromContext(ctx)
	r.svc.Record(ctx, projects.ActivityInput{
		OrgID:      orgID,
		ProjectID:  projectName,
		Type:       activityvocab.TypeSpecUpdated,
		ActorKind:  activityvocab.ActorUser,
		ActorID:    email,
		ActorName:  name,
		DedupKey:   "apply:" + commitSHA,
		OccurredAt: time.Now().UTC(),
	})
}

// turnActivityRecorder implements spec.TurnActivityRecorder: a genai turn
// authored spec changes. A turn is the agent working, so the actor is always the
// agent (the console renders "Spec agent updated the spec"). It also marks the
// project as agent-authored so the committer's later flush of the same edits is
// suppressed rather than double-recorded as a manual edit. Deduped by turn id.
type turnActivityRecorder struct {
	svc        *projects.ActivityService
	authorship *specAuthorship
}

func (r turnActivityRecorder) RecordSpecUpdated(ctx context.Context, orgID, projectID, turnID, title string) {
	r.authorship.markAgent(orgID, projectID)
	r.svc.Record(ctx, projects.ActivityInput{
		OrgID:      orgID,
		ProjectID:  projectID,
		Type:       activityvocab.TypeSpecUpdated,
		ActorKind:  activityvocab.ActorAgent,
		ActorID:    "spec-agent",
		ActorName:  "Spec agent",
		Title:      title,
		DedupKey:   "turn:" + turnID + ":committed",
		OccurredAt: time.Now().UTC(),
	})
}

// userIdentityFromContext returns (email, displayName) for the signed-in user,
// for stamping a user-actor activity event. The email doubles as the stable
// actor id (it is what the console's #130 "You" comparison keys on).
//
// The verified claims projection (auth.Claims / jwtassertion.TokenClaims) never
// carries email or display name — only sub/ouId/ouName/ouHandle/client_id.
// Those fields only exist on the raw IdP token, so — exactly like the collab
// handlers — this re-parses the still-available raw bearer token (jwtassertion
// stashes it in ctx alongside the verified claims) with
// spec.ParseDisplayIdentity, a best-effort, unverified read of display fields
// only; the signature was already verified upstream by the JWT middleware.
func userIdentityFromContext(ctx context.Context) (email, name string) {
	tok := jwtassertion.GetJWTFromContext(ctx)
	if tok == "" {
		return "", "You"
	}
	name, email = spec.ParseDisplayIdentity("Bearer " + tok)
	if name == "" {
		name = "You"
	}
	return email, name
}
