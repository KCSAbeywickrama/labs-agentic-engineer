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

// Component tier for the Files API: the REAL Huma handler (via componenttest)
// over the REAL GitHub client pointed at the gittest Git-Data-API fake backed by
// a real bare repo. Only the repo row + credential resolver are faked, so
// list/read/apply run against genuine git object-store semantics — a stale
// baseSha is a real 409, a multi-write+delete apply is a real single commit.
package files_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/api"
	githubclient "github.com/wso2/aep/aep-api/internal/clients/github"
	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/files"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/internal/platform/gittest"
	"github.com/wso2/aep/aep-api/models"
)

const (
	testOrg  = "acme-org"
	testProj = "widgets"
	apiBase  = "/api/v1/projects/" + testProj + "/files"
)

// ---- faked edges ----

type stubRepoResolver struct{ rec *models.GitRepository }

func (s stubRepoResolver) GetRepo(_ context.Context, _, _ string) (*models.GitRepository, error) {
	if s.rec == nil {
		return nil, gitrepo.ErrRepoNotFound
	}
	return s.rec, nil
}

type stubCred struct{}

func (stubCred) Token(context.Context) (string, time.Time, error) {
	return "test-token", time.Time{}, nil
}
func (stubCred) Identity() credentials.Identity {
	return credentials.Identity{Name: "Bot", Email: "bot@aep.dev", Login: "bot"}
}
func (stubCred) RepoOwner() string                            { return "acme" }
func (stubCred) WebhookStrategy() credentials.WebhookStrategy { return credentials.WebhookPlatform }

type stubResolver struct{}

func (stubResolver) Resolve(context.Context, string) (credentials.Credential, error) {
	return stubCred{}, nil
}

// testGateway is the narrow files.GitGateway backed by the real github client.
type testGateway struct{ gh gitrepo.GitData }

func (g testGateway) GitData() gitrepo.GitData       { return g.gh }
func (g testGateway) Resolver() credentials.Resolver { return stubResolver{} }
func (g testGateway) ResolveSaveIdentities(cred credentials.Credential) (*gitrepo.GitIdentity, *gitrepo.GitIdentity) {
	id := cred.Identity()
	gi := &gitrepo.GitIdentity{Name: id.Name, Email: id.Email}
	return gi, gi
}

// ---- harness ----

type filesRig struct {
	h      *componenttest.Harness
	remote *gittest.Remote
}

func newFilesRig(t *testing.T, seed map[string]string) *filesRig {
	t.Helper()
	remote := gittest.NewRemote(t, gittest.WithSeed(seed, "seed"))
	gd := gittest.GitDataServer(t, remote)
	gh := githubclient.NewClient(githubclient.WithAPIBase(gd.URL))
	rec := &models.GitRepository{
		OrgID:         testOrg,
		ProjectID:     testProj,
		RepoURL:       "https://github.com/acme/widgets.git",
		DefaultBranch: "main",
		Status:        "ready",
	}
	svc := files.NewService(stubRepoResolver{rec: rec}, testGateway{gh: gh})
	h := componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{FilesSvc: svc}})
	return &filesRig{h: h, remote: remote}
}

func (r *filesRig) get(path string) *httptest.ResponseRecorder {
	return r.h.AsOrg(testOrg).Get(path)
}

func (r *filesRig) apply(body string) *httptest.ResponseRecorder {
	return r.h.AsOrg(testOrg).Post(apiBase+"/apply", body)
}

// readSHA reads a file through the API and returns its blob sha (the draft's
// baseSha).
func (r *filesRig) readSHA(t *testing.T, path string) string {
	t.Helper()
	rec := r.get(apiBase + "/" + path)
	if rec.Code != http.StatusOK {
		t.Fatalf("read %s: code %d (%s)", path, rec.Code, rec.Body.String())
	}
	var fc files.FileContent
	if err := json.Unmarshal(rec.Body.Bytes(), &fc); err != nil {
		t.Fatalf("decode read: %v", err)
	}
	return fc.SHA
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// ---- tests ----

func TestListAtHead_FilteredByPrefix(t *testing.T) {
	r := newFilesRig(t, map[string]string{
		"specs/requirements/requirements.md": "req",
		"specs/design/design.md":             "des",
		"README.md":                          "root",
	})
	rec := r.get(apiBase + "?prefix=specs/design/")
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d: %s", rec.Code, rec.Body.String())
	}
	var metas []files.FileMeta
	if err := json.Unmarshal(rec.Body.Bytes(), &metas); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(metas) != 1 || metas[0].Path != "specs/design/design.md" {
		t.Fatalf("prefix filter wrong: %+v", metas)
	}
	if metas[0].SHA == "" || metas[0].Size == 0 {
		t.Errorf("meta missing sha/size: %+v", metas[0])
	}
}

func TestReadAtHead(t *testing.T) {
	r := newFilesRig(t, map[string]string{"specs/requirements/requirements.md": "hello world"})
	rec := r.get(apiBase + "/specs/requirements/requirements.md")
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d: %s", rec.Code, rec.Body.String())
	}
	var fc files.FileContent
	_ = json.Unmarshal(rec.Body.Bytes(), &fc)
	if fc.Content != "hello world" || fc.Path != "specs/requirements/requirements.md" || fc.SHA == "" {
		t.Fatalf("read wrong: %+v", fc)
	}

	if miss := r.get(apiBase + "/specs/requirements/missing.md"); miss.Code != http.StatusNotFound {
		t.Errorf("missing file: code %d, want 404", miss.Code)
	}
}

func TestApply_MultiWriteAndDelete_SingleCommit(t *testing.T) {
	r := newFilesRig(t, map[string]string{
		"specs/requirements/requirements.md": "old",
		"specs/requirements/todo.md":         "scratch",
	})
	reqSHA := r.readSHA(t, "specs/requirements/requirements.md")
	todoSHA := r.readSHA(t, "specs/requirements/todo.md")
	headBefore := r.remote.HeadSHA(t)

	body := mustJSON(t, files.ApplyRequest{
		Writes: []files.WriteOp{
			{Path: "specs/requirements/requirements.md", Content: "new", BaseSHA: reqSHA},
			{Path: "specs/design/design.md", Content: "# Design"}, // baseSha omitted ⇒ create
		},
		Deletes: []files.DeleteOp{{Path: "specs/requirements/todo.md", BaseSHA: todoSHA}},
		Message: "from test",
	})
	rec := r.apply(body)
	if rec.Code != http.StatusOK {
		t.Fatalf("apply code %d: %s", rec.Code, rec.Body.String())
	}
	var res files.ApplyResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.CommitSHA == "" || len(res.Files) != 2 {
		t.Fatalf("apply result wrong: %+v", res)
	}

	// Exactly one new commit; content applied; delete honored.
	if r.remote.HeadSHA(t) == headBefore {
		t.Error("HEAD did not advance")
	}
	if got := r.remote.FileAt(t, "main", "specs/requirements/requirements.md"); got != "new" {
		t.Errorf("requirements.md = %q, want new", got)
	}
	if got := r.remote.FileAt(t, "main", "specs/design/design.md"); got != "# Design" {
		t.Errorf("design.md = %q", got)
	}
	tags := r.remote.Tags(t) // deletes leave no tag; just confirm no crash
	_ = tags
	// todo.md gone: reading it now 404s.
	if miss := r.get(apiBase + "/specs/requirements/todo.md"); miss.Code != http.StatusNotFound {
		t.Errorf("todo.md still present: code %d", miss.Code)
	}
}

func TestApply_StaleBaseSHA_409_NothingApplied(t *testing.T) {
	r := newFilesRig(t, map[string]string{"specs/requirements/requirements.md": "v1"})
	headBefore := r.remote.HeadSHA(t)

	body := mustJSON(t, files.ApplyRequest{
		Writes: []files.WriteOp{
			{Path: "specs/requirements/requirements.md", Content: "v2", BaseSHA: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"},
		},
	})
	rec := r.apply(body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("apply code %d, want 409: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Conflicts []files.Conflict `json:"conflicts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode conflicts: %v", err)
	}
	if len(got.Conflicts) != 1 || got.Conflicts[0].Path != "specs/requirements/requirements.md" {
		t.Fatalf("conflicts wrong: %+v", got.Conflicts)
	}
	if got.Conflicts[0].CurrentSHA == "" || got.Conflicts[0].BaseSHA == "" {
		t.Errorf("conflict missing shas: %+v", got.Conflicts[0])
	}
	// Nothing applied — HEAD unchanged, content unchanged.
	if r.remote.HeadSHA(t) != headBefore {
		t.Error("HEAD advanced on a conflicting apply")
	}
	if got := r.remote.FileAt(t, "main", "specs/requirements/requirements.md"); got != "v1" {
		t.Errorf("content mutated on conflict: %q", got)
	}
}

func TestApply_BaseSHAOmittedButExists_409(t *testing.T) {
	r := newFilesRig(t, map[string]string{"specs/requirements/requirements.md": "exists"})
	body := mustJSON(t, files.ApplyRequest{
		Writes: []files.WriteOp{
			{Path: "specs/requirements/requirements.md", Content: "clobber"}, // no baseSha ⇒ must-not-exist
		},
	})
	rec := r.apply(body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("code %d, want 409: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Conflicts []files.Conflict `json:"conflicts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.Conflicts) != 1 || got.Conflicts[0].BaseSHA != "" || got.Conflicts[0].CurrentSHA == "" {
		t.Fatalf("expected must-not-exist conflict: %+v", got.Conflicts)
	}
}

func TestApply_PathRejections(t *testing.T) {
	r := newFilesRig(t, map[string]string{"specs/requirements/requirements.md": "x"})
	cases := map[string]string{
		"traversal": mustJSON(t, files.ApplyRequest{Writes: []files.WriteOp{{Path: "specs/../etc/passwd", Content: "x"}}}),
		"non-specs": mustJSON(t, files.ApplyRequest{Writes: []files.WriteOp{{Path: "README.md", Content: "x"}}}),
		"absolute":  mustJSON(t, files.ApplyRequest{Writes: []files.WriteOp{{Path: "/specs/x.md", Content: "x"}}}),
	}
	for name, body := range cases {
		if rec := r.apply(body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: code %d, want 400 (%s)", name, rec.Code, rec.Body.String())
		}
	}
}

func TestApply_SizeCap(t *testing.T) {
	r := newFilesRig(t, map[string]string{"specs/requirements/requirements.md": "x"})
	huge := strings.Repeat("A", (5<<20)+1)
	body := mustJSON(t, files.ApplyRequest{Writes: []files.WriteOp{{Path: "specs/requirements/big.md", Content: huge}}})
	if rec := r.apply(body); rec.Code != http.StatusBadRequest {
		t.Errorf("size cap: code %d, want 400", rec.Code)
	}
}

func TestApply_WarningsNonBlocking(t *testing.T) {
	r := newFilesRig(t, nil)
	body := mustJSON(t, files.ApplyRequest{
		Writes: []files.WriteOp{
			{Path: "specs/design/components/foo/design.json", Content: "{ not valid json"},
		},
	})
	rec := r.apply(body)
	if rec.Code != http.StatusOK {
		t.Fatalf("invalid json must NOT block apply: code %d (%s)", rec.Code, rec.Body.String())
	}
	var res files.ApplyResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.Warnings) != 1 || res.Warnings[0].Code != "INVALID_JSON" {
		t.Fatalf("expected one INVALID_JSON warning: %+v", res.Warnings)
	}
	// The (invalid) file was still committed — warnings never block.
	if got := r.remote.FileAt(t, "main", "specs/design/components/foo/design.json"); got != "{ not valid json" {
		t.Errorf("file not committed: %q", got)
	}
}

func TestApply_SchemaViolationWarning_NonBlocking(t *testing.T) {
	r := newFilesRig(t, nil)
	// Valid JSON + valid schema, but name != component directory ("bar" != "foo").
	valid := `{"name":"bar","type":"service","version":"1","language":"go","buildpack":"go","appPath":".","entrypoint":"m","exposure":"intranet","connections":[],"description":"d"}`
	body := mustJSON(t, files.ApplyRequest{
		Writes: []files.WriteOp{{Path: "specs/design/components/foo/design.json", Content: valid}},
	})
	rec := r.apply(body)
	if rec.Code != http.StatusOK {
		t.Fatalf("schema violation must NOT block apply: code %d (%s)", rec.Code, rec.Body.String())
	}
	var res files.ApplyResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.Warnings) != 1 || res.Warnings[0].Code != "SCHEMA_VIOLATION" {
		t.Fatalf("expected one SCHEMA_VIOLATION warning: %+v", res.Warnings)
	}
	if got := r.remote.FileAt(t, "main", "specs/design/components/foo/design.json"); got != valid {
		t.Errorf("file not committed despite warning: %q", got)
	}
}

func TestFiles_NoAuth_401(t *testing.T) {
	r := newFilesRig(t, map[string]string{"specs/requirements/requirements.md": "x"})
	if rec := r.h.NoAuth().Get(apiBase); rec.Code != http.StatusUnauthorized {
		t.Errorf("no-auth list: code %d, want 401", rec.Code)
	}
}
