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

package sourcecontrol_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools/aestudiotest"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// newWebhookSvcOnFake wires a REAL webhookService with a REAL repoService (so
// SetWebhookID's lookup+persist body actually executes) at the in-memory pod.
// Everything shares ONE fake repo store, whose record is how tests assert
// persistence.
func newWebhookSvcOnFake(t *testing.T) (sourcecontrol.WebhookService, *fakeRepoRepo, *aestudiotest.Fake) {
	t.Helper()
	repo := newFakeRepoRepo()
	repo.preload(&sourcecontrol.GitRepository{OrgID: "org1", ProjectID: "proj1", RepoURL: "https://github.com/acme/widgets", Status: "ready"})
	f := aestudiotest.New()
	repoSvc := sourcecontrol.NewRepoService(repo, f, f, fakeOwners{owner: "acme"}, "public")
	return sourcecontrol.NewWebhookService(repo, f, repoSvc), repo, f
}

// storedWebhookID reads the persisted WebhookID off the shared fake repo record.
func storedWebhookID(t *testing.T, repo *fakeRepoRepo, org, proj string) *int64 {
	t.Helper()
	rec, err := repo.GetByOrgAndProjectID(context.Background(), org, proj)
	if err != nil || rec == nil {
		t.Fatalf("repo record %s/%s: rec=%v err=%v", org, proj, rec, err)
	}
	return rec.WebhookID
}

// The hook asks the org's pod for the four project events (the pod owns the
// delivery URL and the signing secret) and persists the hook id.
func TestWebhookRegister_HappyPathRegistersTheEventsAndPersistsID(t *testing.T) {
	t.Parallel()
	wh, repo, f := newWebhookSvcOnFake(t)

	hookID, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	hooks := f.HookEvents(widgets)
	if hookID == nil || len(hooks) != 1 {
		t.Fatalf("hookID = %v, hooks = %v, want one hook", hookID, hooks)
	}
	if got := hooks[*hookID]; !slices.Equal(got, []string{"pull_request", "push", "issue_comment", "issues"}) {
		t.Fatalf("events = %v, want [pull_request push issue_comment issues]", got)
	}
	// Persistence asserted through the REAL repoService.SetWebhookID body:
	// lookup + pointer-set + repo.Update all executed against the shared store.
	if got := storedWebhookID(t, repo, "org1", "proj1"); got == nil || *got != *hookID {
		t.Fatalf("persisted WebhookID = %v, want %d", got, *hookID)
	}
}

// The pod's register-hook is an ensure: an existing hook to its URL has its
// events replaced in the same call, so Register is that one call and a hook
// created before "issues" joined the subscription gets it (§9.2 cutover).
func TestWebhookRegister_OneEnsureCallReplacesTheEvents(t *testing.T) {
	t.Parallel()
	wh, _, f := newWebhookSvcOnFake(t)
	oldHook, err := f.RegisterWebhook(testContext(), widgets, 0, []string{"push"})
	old := oldHook.ID
	if err != nil {
		t.Fatal(err)
	}
	seen := len(f.Calls())

	hookID, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil || hookID == nil || *hookID != old {
		t.Fatalf("Register = (%v, %v), want the existing hook %d", hookID, err, old)
	}
	var got []string
	for _, c := range f.Calls()[seen:] {
		got = append(got, c.Op)
	}
	if want := []string{aestudiotest.OpRegisterWebhook}; !slices.Equal(got, want) {
		t.Fatalf("ops = %v, want %v", got, want)
	}
	if ev := f.HookEvents(widgets)[old]; !slices.Equal(ev, []string{"pull_request", "push", "issue_comment", "issues"}) {
		t.Fatalf("events = %v, want the full subscription", ev)
	}
}

// Registering again answers the same hook (the pod ensures it) and
// reconciles its events.
func TestWebhookRegister_IsIdempotent(t *testing.T) {
	t.Parallel()
	wh, repo, f := newWebhookSvcOnFake(t)
	first, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil || *second != *first {
		t.Fatalf("second register = (%v, %v), want hook %d", second, err, *first)
	}
	if hooks := f.HookEvents(widgets); len(hooks) != 1 {
		t.Fatalf("hooks = %v, want one", hooks)
	}
	if got := storedWebhookID(t, repo, "org1", "proj1"); got == nil || *got != *first {
		t.Fatalf("persisted WebhookID = %v, want %d", got, *first)
	}
}

// storedHook reads the persisted hook id and config rev off the fake row.
func storedHook(t *testing.T, repo *fakeRepoRepo) (int64, string) {
	t.Helper()
	rec, err := repo.GetByOrgAndProjectID(context.Background(), "org1", "proj1")
	if err != nil || rec == nil || rec.WebhookID == nil {
		t.Fatalf("repo record: rec=%v err=%v", rec, err)
	}
	return *rec.WebhookID, rec.WebhookConfigRev
}

// The hook repair's case: the org's pod moved onto another config (its
// relay channel moved, its webhook secret changed), so the stored hook no
// longer delivers to the pod's URL. Register hands the pod the STORED id, so
// that hook is reconfigured in place (no second hook beside it, posting to
// the dead channel), and the row stores the rev the hook now carries,
// which is the rev HookRev answers.
func TestWebhookRegister_ReconfiguresTheStoredHookAtTheCurrentConfig(t *testing.T) {
	t.Parallel()
	wh, repo, f := newWebhookSvcOnFake(t)
	first, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil {
		t.Fatal(err)
	}
	_, staleRev := storedHook(t, repo)
	f.SetHookConfigRev("org1", "fedcba9876543210")

	again, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil || *again != *first {
		t.Fatalf("Register = (%v, %v), want the stored hook %d", again, err, *first)
	}
	if hooks := f.HookEvents(widgets); len(hooks) != 1 {
		t.Fatalf("hooks = %v, want the stored one only", hooks)
	}
	if got := f.HookConfigRevs(widgets)[*first]; got != "fedcba9876543210" {
		t.Fatalf("hook config rev %q, want the pod's current config", got)
	}
	id, rev := storedHook(t, repo)
	current, err := wh.HookRev(testContext(), "org1")
	if err != nil || id != *first || rev != current || rev == staleRev {
		t.Fatalf("stored (%d, %q), want (%d, HookRev %q), changed from %q (err %v)", id, rev, *first, current, staleRev, err)
	}
}

// A stored hook GitHub no longer has (deleted by hand, reaped) is created
// again, and the new id replaces the stored one.
func TestWebhookRegister_RecreatesAStoredHookGitHubLost(t *testing.T) {
	t.Parallel()
	wh, repo, f := newWebhookSvcOnFake(t)
	lost := int64(4242)
	if _, err := repo.SetWebhookIDIfReady(testContext(), "org1", "proj1", lost, "old"); err != nil {
		t.Fatal(err)
	}
	got, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil || *got == lost {
		t.Fatalf("Register = (%v, %v), want a new hook", got, err)
	}
	if id, _ := storedHook(t, repo); id != *got || len(f.HookEvents(widgets)) != 1 {
		t.Fatalf("stored %d, hooks %v, want the new hook %d", id, f.HookEvents(widgets), *got)
	}
}

// The rev covers the subscribed events as well as the pod's config, so a
// release that changes the subscription re-syncs every hook.
func TestWebhookHookRev_FollowsThePodsConfig(t *testing.T) {
	t.Parallel()
	wh, _, f := newWebhookSvcOnFake(t)
	before, err := wh.HookRev(testContext(), "org1")
	if err != nil || before == "" || before == aestudiotest.DefaultHookConfigRev {
		t.Fatalf("HookRev = (%q, %v), want the pod rev folded with the events", before, err)
	}
	f.SetHookConfigRev("org1", "fedcba9876543210")
	if after, _ := wh.HookRev(testContext(), "org1"); after == before {
		t.Fatal("HookRev must move with the pod's config")
	}
	f.FailOrg("org1", sourcecontrol.ErrAEStudioUnavailable)
	if _, err := wh.HookRev(testContext(), "org1"); !errors.Is(err, sourcecontrol.ErrAEStudioUnavailable) {
		t.Fatalf("err = %v, want the pod's", err)
	}
}

// A reconnect asks for a re-sync: every row of the org keeps its hook id
// and loses its rev, so the hook repair re-ensures each in place.
func TestWebhookResyncOrg_ForgetsTheRevsAndKeepsTheIDs(t *testing.T) {
	t.Parallel()
	wh, repo, _ := newWebhookSvcOnFake(t)
	first, err := wh.Register(testContext(), "org1", "proj1")
	if err != nil {
		t.Fatal(err)
	}
	if err := wh.ResyncOrg(testContext(), "org1"); err != nil {
		t.Fatal(err)
	}
	if id, rev := storedHook(t, repo); id != *first || rev != "" {
		t.Fatalf("stored (%d, %q), want (%d, \"\")", id, rev, *first)
	}
}

// The pod being down fails the registration loudly and persists nothing.
func TestWebhookRegister_PodFailureIsReported(t *testing.T) {
	t.Parallel()
	wh, repo, f := newWebhookSvcOnFake(t)
	f.FailOrg("org1", sourcecontrol.ErrAEStudioUnavailable)

	if _, err := wh.Register(testContext(), "org1", "proj1"); !errors.Is(err, sourcecontrol.ErrAEStudioUnavailable) {
		t.Fatalf("err = %v, want ErrAEStudioUnavailable", err)
	}
	if got := storedWebhookID(t, repo, "org1", "proj1"); got != nil {
		t.Fatalf("WebhookID = %v after a failed register, want unset", *got)
	}
}

func TestWebhookRegister_UnknownProjectIsRepoNotFound(t *testing.T) {
	t.Parallel()
	wh, _, f := newWebhookSvcOnFake(t)

	if _, err := wh.Register(testContext(), "org1", "no-such-project"); !errors.Is(err, sourcecontrol.ErrRepoNotFound) {
		t.Fatalf("err = %v, want ErrRepoNotFound", err)
	}
	if n := len(f.Calls()); n != 0 {
		t.Fatalf("the pod was called %d times, want 0", n)
	}
}
