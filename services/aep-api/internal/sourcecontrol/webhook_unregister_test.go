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
	"fmt"
	"net/http"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/gittest"
	"github.com/wso2/aep/aep-api/internal/platform/secrets"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// Unregister is Register run backwards, and the property that matters most is
// PRECISION: it deletes the hook whose id the platform persisted at
// registration, never a hook it found by scanning. Repositories carry other
// integrations' webhooks, and a project delete has no business touching them.
//
// Everything else about it is total. A project with no repo row, no stored hook
// or a platform-strategy credential has nothing of ours installed, and a hook
// GitHub has already dropped is the post-state we wanted anyway.

const hookPath = "/repos/acme/widgets/hooks/12345"

// registerHook drives a real registration so the hook id is persisted the way
// production persists it — the test then unregisters what registration stored,
// rather than a number the test made up.
func registerHook(t *testing.T, stub *gittest.Stub, wh sourcecontrol.WebhookService) {
	t.Helper()
	stub.On(http.MethodPost, "/repos/acme/widgets/hooks", http.StatusCreated, `{"id":12345}`)
	stub.On(http.MethodPatch, hookPath, http.StatusOK, `{}`)
	if _, err := wh.Register(context.Background(), "org1", "proj1"); err != nil {
		t.Fatalf("Register: %v", err)
	}
}

func TestWebhookUnregister_DeletesTheStoredHook(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	wh, repo := newWebhookSvcOnStub(t, stub, secrets.WebhookPerRepo)
	registerHook(t, stub, wh)
	if got := storedWebhookID(t, repo, "org1", "proj1"); got == nil || *got != 12345 {
		t.Fatalf("precondition: stored hook id = %v, want 12345", got)
	}
	stub.On(http.MethodDelete, hookPath, http.StatusNoContent, "")

	if err := wh.Unregister(context.Background(), "org1", "proj1"); err != nil {
		t.Fatalf("Unregister: %v", err)
	}

	// The DELETE went to the STORED hook's id, and nothing listed the repo's
	// hooks looking for something to remove.
	var deletes, lists int
	for _, r := range stub.Requests() {
		if r.Method == http.MethodDelete && r.Path == hookPath {
			deletes++
		}
		if r.Method == http.MethodGet && r.Path == "/repos/acme/widgets/hooks" {
			lists++
		}
	}
	if deletes != 1 {
		t.Errorf("DELETE %s sent %d times, want 1", hookPath, deletes)
	}
	if lists != 0 {
		t.Errorf("Unregister listed the repo's hooks %d times; it must address the stored id only", lists)
	}
}

// TestWebhookUnregister_AlreadyGoneHookIsSuccess covers the two ways GitHub says
// "that hook is not here": a plain 404, and the 410 it returns once a hook has
// been auto-disabled and reaped after repeated delivery failures — which is
// exactly where an orphaned webhook ends up.
func TestWebhookUnregister_AlreadyGoneHookIsSuccess(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		status int
	}{
		{"404 not found", http.StatusNotFound},
		{"410 gone", http.StatusGone},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			stub := gittest.NewStub(t)
			wh, _ := newWebhookSvcOnStub(t, stub, secrets.WebhookPerRepo)
			registerHook(t, stub, wh)
			stub.On(http.MethodDelete, hookPath, tc.status, `{"message":"Not Found"}`)

			if err := wh.Unregister(context.Background(), "org1", "proj1"); err != nil {
				t.Fatalf("an already-absent hook must be success, got %v", err)
			}
		})
	}
}

func TestWebhookUnregister_IsIdempotent(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	wh, _ := newWebhookSvcOnStub(t, stub, secrets.WebhookPerRepo)
	registerHook(t, stub, wh)
	// First call removes it; every call after that finds it gone.
	stub.OnSequence(http.MethodDelete, hookPath,
		gittest.Response{Status: http.StatusNoContent},
		gittest.Response{Status: http.StatusNotFound, Body: `{"message":"Not Found"}`},
	)

	for attempt := 1; attempt <= 2; attempt++ {
		if err := wh.Unregister(context.Background(), "org1", "proj1"); err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
	}
}

// TestWebhookUnregister_NothingRegisteredIsANoOp: no hook id was ever persisted,
// so there is nothing of ours on the repo. It must not probe GitHub at all —
// guessing which hook was "probably" ours is what this design refuses to do.
func TestWebhookUnregister_NothingRegisteredIsANoOp(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	wh, _ := newWebhookSvcOnStub(t, stub, secrets.WebhookPerRepo)

	if err := wh.Unregister(context.Background(), "org1", "proj1"); err != nil {
		t.Fatalf("no stored hook must be a no-op, got %v", err)
	}
	if n := len(stub.Requests()); n != 0 {
		t.Errorf("Unregister made %d GitHub calls with no hook stored, want 0", n)
	}
}

// TestWebhookUnregister_UnknownProjectIsANoOp: the repo row is already gone, so
// the platform cannot name a hook. Nothing to do, and not an error — the project
// teardown re-runs this path.
func TestWebhookUnregister_UnknownProjectIsANoOp(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	wh, _ := newWebhookSvcOnStub(t, stub, secrets.WebhookPerRepo)

	if err := wh.Unregister(context.Background(), "org1", "no-such-project"); err != nil {
		t.Fatalf("an unresolvable project must be a no-op, got %v", err)
	}
}

// TestWebhookUnregister_PlatformStrategyIsANoOp mirrors Register's short-circuit:
// App-installation delivery never installed a per-repo hook, so there is none to
// remove.
func TestWebhookUnregister_PlatformStrategyIsANoOp(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	wh, repo := newWebhookSvcOnStub(t, stub, secrets.WebhookPlatform)
	// Stamp a hook id directly: under App mode Register would never persist one,
	// and this proves the strategy check — not an absent id — is what stops it.
	hookID := int64(12345)
	repo.preload(&sourcecontrol.GitRepository{
		OrgID: "org1", ProjectID: "proj1",
		RepoURL: "https://github.com/acme/widgets", WebhookID: &hookID,
	})

	if err := wh.Unregister(context.Background(), "org1", "proj1"); err != nil {
		t.Fatalf("platform strategy must be a no-op, got %v", err)
	}
	if n := len(stub.Requests()); n != 0 {
		t.Errorf("Unregister made %d GitHub calls under platform delivery, want 0", n)
	}
}

// TestWebhookUnregister_GitHubFailureIsReported: only a live failure to reach
// GitHub is an error. The project teardown swallows it (see
// TestDeleteProject_WebhookUnregisterFailureIsSwallowed) — but it has to be told,
// or the log line naming the leftover hook could never be written.
func TestWebhookUnregister_GitHubFailureIsReported(t *testing.T) {
	t.Parallel()
	stub := gittest.NewStub(t)
	wh, _ := newWebhookSvcOnStub(t, stub, secrets.WebhookPerRepo)
	registerHook(t, stub, wh)
	stub.On(http.MethodDelete, hookPath, http.StatusInternalServerError, `{"message":"boom"}`)

	err := wh.Unregister(context.Background(), "org1", "proj1")
	if err == nil {
		t.Fatal("a 500 from GitHub must be reported, got nil")
	}
	if got := fmt.Sprint(err); got == "" {
		t.Error("error must carry a message")
	}
}
