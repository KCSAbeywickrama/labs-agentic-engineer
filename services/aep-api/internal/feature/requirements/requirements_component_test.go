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

// COMPONENT tier (bff-component-testing.md §4): the REAL requirements +
// requirements-chat + collab services behind the REAL production chain — global
// middleware → faked auth at the jwt.WithClaims seam → orgensure → Huma
// parsing/validation → the tenant gate in ENFORCE → each handler's inline error
// mapping — driven in-process via the componenttest harness. Only the artifact
// seam is faked (real ArtifactStore decorator over FakeArtifactService); the
// agents client is nil because no streaming route is exercised here (StreamGenerate/
// StreamChat completion + side-effects are unit-proven, per the SSE rule §7).
//
// ORG SCOPE: the active org is derived SOLELY from the token (no {orgHandle}
// path param), so the only runtime auth assertion the tier adds is the gate's
// no-claims 401 on an org-scoped op (proven once for the feature).
//
// GOLDEN FIELD SETS: the harvested goldens carry a Huma `$schema` link field
// that the current handler (api/huma.go: SchemasPath="") no longer emits, so the
// on-wire field set is compared with $schema excluded from both sides.
//
// External test package: the harness imports api, which imports requirements — an
// in-package test file would be an import cycle.
package requirements_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/requirements"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
)

const reqPrefix = "/api/v1/projects/web/requirements"

// --- fakes / harness ---------------------------------------------------------

// fakeCollabRepos is the collab project-ownership oracle (gitrepo.RepoService).
// Only GetRepo is consulted by the collab handlers; the other methods panic.
type fakeCollabRepos struct {
	GetRepoFunc func(ctx context.Context, orgID, projectID string) (*models.GitRepository, error)
}

var _ gitrepo.RepoService = (*fakeCollabRepos)(nil)

func (f *fakeCollabRepos) GetRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error) {
	if f.GetRepoFunc == nil {
		panic("fakeCollabRepos: GetRepo not set")
	}
	return f.GetRepoFunc(ctx, orgID, projectID)
}
func (f *fakeCollabRepos) CreateRepo(context.Context, string, string, string) (*models.GitRepository, error) {
	panic("fakeCollabRepos: CreateRepo not expected")
}
func (f *fakeCollabRepos) EnsureBareRepo(context.Context, string, string, string) (*models.GitRepository, error) {
	panic("fakeCollabRepos: EnsureBareRepo not expected")
}
func (f *fakeCollabRepos) SetWebhookID(context.Context, string, string, int64) error {
	panic("fakeCollabRepos: SetWebhookID not expected")
}
func (f *fakeCollabRepos) DeleteRepo(context.Context, string, string) error {
	panic("fakeCollabRepos: DeleteRepo not expected")
}

// newReqHarness assembles the real chain around the REAL requirements/chat/collab
// services. The store decorator wraps `fake`; the agents client is nil (no
// streaming route driven here); no locker (withLock runs inline — lock contention
// is proven in the dbtest tier and, for the 409 mapping, the DB-backed test below).
func newReqHarness(t *testing.T, fake *artifactstest.FakeArtifactService, repos gitrepo.RepoService) *componenttest.Harness {
	t.Helper()
	store := artifacts.NewArtifactStore(fake)
	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{
		RequirementsSvc:     requirements.NewRequirementsService(store, nil, fake),
		RequirementsChatSvc: requirements.NewRequirementsChatService(store, nil, fake, nil),
		CollabRepo:          repos,
	}})
}

// goldenPath resolves a harvested golden by name.
func goldenPath(name string) string {
	return filepath.Join("..", "..", "..", "testdata", "harvest", "golden", name)
}

// sansSchema drops the Huma `$schema` link key so a harvested golden's field set
// (which still carries it) compares against the current handler's (which omits it).
func sansSchema(keys []string) []string {
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		if k != "$schema" {
			out = append(out, k)
		}
	}
	return out
}

// readFile reads a golden file into bytes, failing the test on error.
func readFile(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return b
}

// firstElementKeys decodes a JSON array of objects and returns element[0]'s
// sorted keys — the low-maintenance element-shape assertion for array responses
// (componenttest.GoldenFieldSet is object-only).
func firstElementKeys(t *testing.T, raw []byte) []string {
	t.Helper()
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err != nil {
		t.Fatalf("not a JSON array of objects: %v\n%s", err, string(raw))
	}
	if len(arr) == 0 {
		t.Fatalf("expected at least one element, got empty array: %s", string(raw))
	}
	keys := make([]string, 0, len(arr[0]))
	for k := range arr[0] {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// --- get-requirements --------------------------------------------------------

func TestReqComponent_GetRequirements_MatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	files := map[string]string{"requirements.md": "# R\n"}
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Version: 1, Tag: "v1", CommitHash: "abc"}}, nil
		},
		GetRequirementsAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R\n"}, nil // equal → no unsaved changes
		},
	}
	h := newReqHarness(t, fake, nil)

	resp := h.AsOrg("acme").Get(reqPrefix)
	if resp.Code != 200 {
		t.Fatalf("get: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_requirements.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("get-requirements field set drifted from golden:\n got %v\nwant %v", got, want)
	}
}

func TestReqComponent_GetRequirements_NoClaimsDeniedByEnforceGate(t *testing.T) {
	t.Parallel()
	h := newReqHarness(t, &artifactstest.FakeArtifactService{}, nil)

	resp := h.NoAuth().Get(reqPrefix)
	if resp.Code != 401 {
		t.Fatalf("no-claims: want the gate's ENFORCE 401, got %d body=%s", resp.Code, resp.Body.String())
	}
	// The gate aggregates its resolver error into one RFC-9457 problem carrying
	// "authentication required" in errors[]; this is NOT the JWT middleware's
	// pre-gate rejection (that path is integration-owned — see §3).
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if p.Status != 401 || len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "authentication required") {
		t.Fatalf("gate 401 problem shape: got %s", resp.Body.String())
	}
}

func TestReqComponent_GetRequirements_OpaqueErrorIs500(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return nil, errors.New("pg: connection refused")
		},
	}
	h := newReqHarness(t, fake, nil)

	resp := h.AsOrg("acme").Get(reqPrefix)
	if resp.Code != 500 {
		t.Fatalf("opaque error: want 500, got %d body=%s", resp.Code, resp.Body.String())
	}
	if strings.Contains(resp.Body.String(), "connection refused") {
		t.Fatalf("500 body leaks internals: %s", resp.Body.String())
	}
}

// --- update-file -------------------------------------------------------------

func TestReqComponent_UpdateFile_HappyAndMissingBody(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"functional.md": "body"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return nil, nil
		},
	}
	h := newReqHarness(t, fake, nil)

	// Happy path: PUT with a well-formed body → 200 with the refreshed bundle.
	resp := h.AsOrg("acme").Put(reqPrefix+"/files/functional.md", `{"content":"hello"}`)
	if resp.Code != 200 {
		t.Fatalf("update: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}

	// Missing body on a required-body op → Huma hard-400 before the handler runs.
	resp = h.AsOrg("acme").Put(reqPrefix+"/files/functional.md", "")
	if resp.Code != 400 {
		t.Fatalf("missing body: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// TestReqComponent_UpdateFile_LockBusyMapsTo409 proves the RequirementsDirLockBusy
// → 409 mapping through the REAL chain. The busy condition is a genuine advisory
// lock, so this rides a real dbtest Postgres and self-skips under -short (fast
// lane). A held session lock forces the writer's pg_try_advisory_xact_lock to
// fail, so the closure never runs (PutFile stays unset — reaching it would panic).
func TestReqComponent_UpdateFile_LockBusyMapsTo409(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t) // self-skips under -short / no Docker
	ctx := context.Background()

	locker := requirements.NewRequirementsDirLocker(db)
	held, err := locker.AcquireSession(ctx, "acme", "web")
	if err != nil {
		t.Fatalf("acquire holding lock: %v", err)
	}
	defer held.Release(ctx)

	fake := &artifactstest.FakeArtifactService{} // no method should be reached
	store := artifacts.NewArtifactStore(fake)
	svc := requirements.NewRequirementsService(store, nil, fake).WithLocker(locker)
	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{RequirementsSvc: svc}})

	resp := h.AsOrg("acme").Put(reqPrefix+"/files/functional.md", `{"content":"x"}`)
	if resp.Code != 409 {
		t.Fatalf("lock busy: want 409, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- save / discard ----------------------------------------------------------

func TestReqComponent_SaveAndDiscard_Happy(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		SaveRequirementsFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.RequirementsSaveResult, error) {
			return &artifacts.RequirementsSaveResult{Status: "approved", Tag: "v2", Version: 2}, nil
		},
		DiscardRequirementsFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R\n"}, nil
		},
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R\n"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return nil, nil
		},
	}
	h := newReqHarness(t, fake, nil)

	if resp := h.AsOrg("acme").Post(reqPrefix+"/save", "{}"); resp.Code != 200 {
		t.Fatalf("save: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if resp := h.AsOrg("acme").Post(reqPrefix+"/discard", "{}"); resp.Code != 200 {
		t.Fatalf("discard: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestReqComponent_Save_SpecNotFoundMapsTo404(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		SaveRequirementsFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.RequirementsSaveResult, error) {
			return nil, artifacts.ErrSpecNotFound
		},
	}
	h := newReqHarness(t, fake, nil)

	resp := h.AsOrg("acme").Post(reqPrefix+"/save", "{}")
	if resp.Code != 404 {
		t.Fatalf("save spec-not-found: want 404, got %d body=%s", resp.Code, resp.Body.String())
	}
	if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "requirements not found" {
		t.Fatalf("404 detail: got %q", p.Detail)
	}
}

// --- list-versions / get-at-version ------------------------------------------

func TestReqComponent_ListVersions_MatchesGoldenElementShape(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Version: 1, Tag: "v1", CommitHash: "abc"}}, nil
		},
	}
	h := newReqHarness(t, fake, nil)

	resp := h.AsOrg("acme").Get(reqPrefix + "/versions")
	if resp.Code != 200 {
		t.Fatalf("list-versions: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	// The golden is a JSON array; compare the element field set (GoldenFieldSet
	// is object-only, so decode the arrays here).
	got := firstElementKeys(t, resp.Body.Bytes())
	want := firstElementKeys(t, readFile(t, goldenPath("get_requirements_versions.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("list-versions element shape drifted from golden:\n got %v\nwant %v", got, want)
	}
}

func TestReqComponent_GetAtVersion_HappyAndNotFound(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		GetRequirementsAtTagFunc: func(_ context.Context, _, _, tag string) (map[string]string, error) {
			if tag == "v9" {
				return nil, artifacts.ErrArtifactNotFound
			}
			return map[string]string{"requirements.md": "# R\n"}, nil
		},
	}
	h := newReqHarness(t, fake, nil)

	resp := h.AsOrg("acme").Get(reqPrefix + "/versions/v1")
	if resp.Code != 200 {
		t.Fatalf("get-at-version: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_requirements_at_version.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("get-at-version field set drifted from golden:\n got %v\nwant %v", got, want)
	}

	// A missing tag → ErrSpecNotFound → 404.
	resp = h.AsOrg("acme").Get(reqPrefix + "/versions/v9")
	if resp.Code != 404 {
		t.Fatalf("get-at-version missing: want 404, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- chat: undo / baseline-file / revert / drop ------------------------------

func TestReqComponent_ChatUndo_Happy(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		RestoreRequirementsSnapshotFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "restored"}, nil
		},
		DeleteRequirementsSnapshotFunc: func(context.Context, string, string, string) error { return nil },
	}
	h := newReqHarness(t, fake, nil)

	resp := h.AsOrg("acme").Post(reqPrefix+"/chat/turns/t_1/undo", "{}")
	if resp.Code != 200 {
		t.Fatalf("undo: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	var out struct {
		Files map[string]string `json:"files"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &out); err != nil {
		t.Fatalf("undo body: %v\n%s", err, resp.Body.String())
	}
	if out.Files["requirements.md"] != "restored" {
		t.Fatalf("undo files: %v", out.Files)
	}
}

func TestReqComponent_ChatBaselineFile_HappyAndNotFound(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ReadFileFromRequirementsSnapshotFunc: func(_ context.Context, _, _, _, filename string) (string, bool, error) {
			if filename == "missing.md" {
				return "", false, artifacts.ErrArtifactNotFound
			}
			return "baseline-body", true, nil
		},
	}
	h := newReqHarness(t, fake, nil)

	resp := h.AsOrg("acme").Get(reqPrefix + "/chat/baseline/sb_1/files/functional.md")
	if resp.Code != 200 {
		t.Fatalf("baseline-file: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}

	resp = h.AsOrg("acme").Get(reqPrefix + "/chat/baseline/sb_1/files/missing.md")
	if resp.Code != 404 {
		t.Fatalf("baseline-file missing: want 404, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestReqComponent_ChatRevertAndDrop_NoContent(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
			return "original", true, nil
		},
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
		DeleteRequirementsSnapshotFunc: func(context.Context, string, string, string) error { return nil },
	}
	h := newReqHarness(t, fake, nil)

	// Revert (existed → write-back) → 204.
	if resp := h.AsOrg("acme").Post(reqPrefix+"/chat/baseline/sb_1/files/functional.md/revert", "{}"); resp.Code != 204 {
		t.Fatalf("revert: want 204, got %d body=%s", resp.Code, resp.Body.String())
	}
	// Drop the baseline snapshot → 204.
	if resp := h.AsOrg("acme").Delete(reqPrefix + "/chat/baseline/sb_1"); resp.Code != 204 {
		t.Fatalf("drop: want 204, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// --- collab ------------------------------------------------------------------

func TestReqComponent_CollabSession_HappyMatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	repos := &fakeCollabRepos{
		GetRepoFunc: func(context.Context, string, string) (*models.GitRepository, error) {
			return &models.GitRepository{RepoURL: "https://github.com/o/r.git"}, nil
		},
	}
	h := newReqHarness(t, &artifactstest.FakeArtifactService{}, repos)

	resp := h.AsOrg("acme").Get(reqPrefix + "/collab-session")
	if resp.Code != 200 {
		t.Fatalf("collab-session: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	// Field set matches the golden (sans $schema). Values differ from the golden
	// because the display identity is decoded from the Authorization Bearer, which
	// the in-process harness does not forward — so userName/email are empty here
	// (their projection is unit-proven in collab_identity_test.go). The room ID is
	// derived from the token org + project.
	got := sansSchema(componenttest.FieldSet(t, resp.Body.String()))
	want := sansSchema(componenttest.GoldenFieldSet(t, goldenPath("get_collab_session.json")))
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("collab-session field set drifted from golden:\n got %v\nwant %v", got, want)
	}
	var body struct {
		RoomID string `json:"roomId"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("collab body: %v", err)
	}
	if body.RoomID != "spec-acme-web" {
		t.Fatalf("roomId: got %q, want spec-acme-web (token org + project)", body.RoomID)
	}
}

func TestReqComponent_CollabSession_UnknownProjectIs404(t *testing.T) {
	t.Parallel()
	repos := &fakeCollabRepos{
		GetRepoFunc: func(context.Context, string, string) (*models.GitRepository, error) {
			return nil, nil // no repo row → project not found
		},
	}
	h := newReqHarness(t, &artifactstest.FakeArtifactService{}, repos)

	resp := h.AsOrg("acme").Get(reqPrefix + "/collab-session")
	if resp.Code != 404 {
		t.Fatalf("collab-session unknown project: want 404, got %d body=%s", resp.Code, resp.Body.String())
	}
}

// TestReqComponent_CollabValidate_MissingRoom drives the server-to-server
// carve-out's reachable input-validation branch. validate-collab-access is NOT
// org-scoped (no OrgScopedInput), so per §3 its verifier auth is integration-owned
// and NOT asserted as a gate here; the room-prefix/oracle branches need an
// X-Room-Id header the in-process request builder can't set, so they stay
// integration-owned too. What is reachable — an authed request with no room →
// 400 — is pinned.
func TestReqComponent_CollabValidate_MissingRoom(t *testing.T) {
	t.Parallel()
	h := newReqHarness(t, &artifactstest.FakeArtifactService{}, &fakeCollabRepos{})

	resp := h.AsOrg("acme").Get("/api/v1/collab/validate")
	if resp.Code != 400 {
		t.Fatalf("collab-validate no room: want 400, got %d body=%s", resp.Code, resp.Body.String())
	}
}
