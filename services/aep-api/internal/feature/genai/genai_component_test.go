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

// Component tier for the genai turn/rehydrate surface: the REAL Huma handler
// (via componenttest) fronting the REAL genai assembler + agentsvc client
// against a fake agents-service HTTP server that records the exact TurnRequest
// the BFF sends. The design-generate at-tag merge runs against the REAL github
// client pointed at the gittest Git-Data-API fake, so the approved-requirements
// gate + bundle read exercise genuine git semantics.
package genai_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	githubclient "github.com/wso2/aep/aep-api/internal/clients/github"
	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/genai"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/internal/platform/gittest"
	"github.com/wso2/aep/aep-api/models"
)

const (
	testOrg  = "acme-org"
	testProj = "widgets"
	convUUID = "550e8400-e29b-41d4-a716-446655440000"
)

func turnPath(uuid string) string {
	return "/api/v1/projects/" + testProj + "/conversations/" + uuid + "/turns"
}
func convPath(uuid string) string {
	return "/api/v1/projects/" + testProj + "/conversations/" + uuid
}

// ---- fake agents service ----

const cannedSSE = "data: {\"type\":\"start\"}\n\ndata: {\"type\":\"tool\"}\n\n: keep-alive\n\ndata: [DONE]\n\n"

type fakeAgents struct {
	*httptest.Server
	mu sync.Mutex

	turnStatus int
	turnBody   string
	convStatus int
	convBody   string

	lastTurnPath    string
	lastTurnBody    string
	lastTurnHeaders http.Header
	turnCount       int
	lastConvPath    string
}

func newFakeAgents(t *testing.T) *fakeAgents {
	t.Helper()
	f := &fakeAgents{turnStatus: 200, turnBody: cannedSSE, convStatus: 200, convBody: `{"messages":[{"role":"user","content":"hi"}]}`}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/turns"):
			b, _ := io.ReadAll(r.Body)
			f.lastTurnPath, f.lastTurnBody, f.lastTurnHeaders = r.URL.Path, string(b), r.Header.Clone()
			f.turnCount++
			if f.turnStatus == 200 {
				w.Header().Set("Content-Type", "text/event-stream")
			}
			w.WriteHeader(f.turnStatus)
			_, _ = io.WriteString(w, f.turnBody)
		case r.Method == http.MethodGet:
			f.lastConvPath = r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(f.convStatus)
			_, _ = io.WriteString(w, f.convBody)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeAgents) sentTurn(t *testing.T) agentsvc.TurnRequest {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	var tr agentsvc.TurnRequest
	if err := json.Unmarshal([]byte(f.lastTurnBody), &tr); err != nil {
		t.Fatalf("decode sent TurnRequest: %v (body=%s)", err, f.lastTurnBody)
	}
	return tr
}

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

type testGitReader struct{ gh gitrepo.GitData }

func (g testGitReader) GitData() gitrepo.GitData       { return g.gh }
func (g testGitReader) Resolver() credentials.Resolver { return stubResolver{} }

// ---- harness ----

type genaiRig struct {
	h    *componenttest.Harness
	fake *fakeAgents
	// knobs read at request time
	key string
	aux []agentsvc.Skill
}

// newGenaiRig wires the real genai service. seed+tagV1 arrange the git remote
// for the design-generate merge; key/aux drive the Anthropic-key and org-skills
// ports. A pointer to the rig is captured by the port closures so a test can set
// rig.key / rig.aux before issuing the request.
func newGenaiRig(t *testing.T, seed map[string]string, tagV1 bool) *genaiRig {
	t.Helper()
	remote := gittest.NewRemote(t, gittest.WithSeed(seed, "seed"))
	if tagV1 {
		remote.Tag(t, "v1", "approve requirements")
	}
	gd := gittest.GitDataServer(t, remote)
	gh := githubclient.NewClient(githubclient.WithAPIBase(gd.URL))
	fake := newFakeAgents(t)
	client := agentsvc.New(agentsvc.Config{BaseURL: fake.URL})

	rec := &models.GitRepository{
		OrgID:         testOrg,
		ProjectID:     testProj,
		RepoURL:       "https://github.com/acme/widgets.git",
		DefaultBranch: "main",
		Status:        "ready",
	}
	rig := &genaiRig{fake: fake, key: "sk-ant-test"}
	svc := genai.NewService(
		stubRepoResolver{rec: rec},
		testGitReader{gh: gh},
		func(context.Context, string) (string, error) { return rig.key, nil },
		func(context.Context, string) ([]agentsvc.Skill, error) { return rig.aux, nil },
		client,
	)
	rig.h = componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{GenAISvc: svc}})
	return rig
}

func (r *genaiRig) turn(useCase string, files map[string]string) *httptest.ResponseRecorder {
	body := map[string]any{"useCase": useCase, "instruction": "do the thing", "files": files}
	b, _ := json.Marshal(body)
	return r.h.AsOrg(testOrg).Post(turnPath(convUUID), string(b))
}

// ---- assembler tests ----

func TestTurn_SnapshotFilteredAndNamespaced(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	rec := r.turn(useCaseRequirementsChat(), map[string]string{
		"specs/requirements/requirements.md":      "md keep",
		"specs/design/components/foo/design.json": "{}",
		"specs/design/wireframes.dsl":             "dsl keep",
		"specs/design/scene.excalidraw":           "{huge scene}",
		"specs/design/cell-diagram.gen.json":      "{proj}",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("turn code %d: %s", rec.Code, rec.Body.String())
	}
	sent := r.fake.sentTurn(t)
	if _, ok := sent.Files["specs/design/scene.excalidraw"]; ok {
		t.Error(".excalidraw leaked into snapshot")
	}
	if _, ok := sent.Files["specs/design/cell-diagram.gen.json"]; ok {
		t.Error("*.gen.json leaked into snapshot")
	}
	for _, keep := range []string{"specs/requirements/requirements.md", "specs/design/components/foo/design.json", "specs/design/wireframes.dsl"} {
		if _, ok := sent.Files[keep]; !ok {
			t.Errorf("agent-authored file dropped: %s", keep)
		}
	}
	if len(sent.Files) != 3 {
		t.Errorf("snapshot size = %d, want 3: %v", len(sent.Files), keys(sent.Files))
	}
	// Namespaced conversation id, FE never sees it.
	wantPrefix := "/conversations/org_" + testOrg + "--proj_" + testProj + "--requirements-chat--" + convUUID
	if !strings.HasPrefix(r.fake.lastTurnPath, wantPrefix) {
		t.Errorf("namespaced path = %q, want prefix %q", r.fake.lastTurnPath, wantPrefix)
	}
	// Steering suffix present.
	if !strings.Contains(sent.Instruction, "requirements draft") {
		t.Errorf("steering suffix missing: %q", sent.Instruction)
	}
	// X-Anthropic-Key forwarded.
	if k := r.fake.lastTurnHeaders.Get("X-Anthropic-Key"); k != "sk-ant-test" {
		t.Errorf("X-Anthropic-Key = %q", k)
	}
}

func TestTurn_RequirementsGenerate_OrgSkillsWithReferences(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	r.aux = []agentsvc.Skill{{
		Name:        "org-style",
		Description: "org custom skill",
		Content:     "# org body",
		References:  map[string]string{"references/guide.md": "ref body"},
	}}
	rec := r.turn(useCaseRequirementsGenerate(), map[string]string{"specs/requirements/requirements.md": "x"})
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d: %s", rec.Code, rec.Body.String())
	}
	sent := r.fake.sentTurn(t)
	// requirements-generate pushes no core flow skill; the org aux skill rides
	// along with its references map intact.
	sk := findSkill(sent.Skills, "org-style")
	if sk == nil {
		t.Fatalf("org aux skill not pushed: %v", sent.Skills)
	}
	if sk.References["references/guide.md"] != "ref body" {
		t.Errorf("references not intact: %+v", sk.References)
	}
	if findSkill(sent.Skills, "high-level-architecture") != nil {
		t.Error("requirements-generate must NOT push design core skills")
	}
	if !strings.Contains(sent.Instruction, "requirements.md") {
		t.Errorf("steering missing: %q", sent.Instruction)
	}
}

func TestTurn_DesignGenerate_GateAndMerge(t *testing.T) {
	// No requirements tag → gate fails pre-stream (4xx), agents never called.
	rNoTag := newGenaiRig(t, map[string]string{"specs/requirements/requirements.md": "reqs"}, false)
	if rec := rNoTag.turn(useCaseDesignGenerate(), map[string]string{"specs/design/design.md": "# d"}); rec.Code < 400 || rec.Code >= 500 {
		t.Fatalf("no-tag design-generate: code %d, want 4xx", rec.Code)
	}
	if rNoTag.fake.turnCount != 0 {
		t.Error("agents service called despite failed gate")
	}

	// Tagged requirements → gate passes; bundle merged at the tag; core skills pushed.
	r := newGenaiRig(t, map[string]string{
		"specs/requirements/requirements.md":  "# Approved reqs",
		"specs/requirements/domain.dsl":       "dsl",
		"specs/requirements/scene.excalidraw": "{scene}",
	}, true)
	rec := r.turn(useCaseDesignGenerate(), map[string]string{"specs/design/design.md": "# draft"})
	if rec.Code != http.StatusOK {
		t.Fatalf("tagged design-generate: code %d: %s", rec.Code, rec.Body.String())
	}
	sent := r.fake.sentTurn(t)
	// FE draft preserved + approved requirements merged (md + dsl), excalidraw excluded.
	if sent.Files["specs/design/design.md"] != "# draft" {
		t.Errorf("FE draft lost: %v", keys(sent.Files))
	}
	if sent.Files["specs/requirements/requirements.md"] != "# Approved reqs" {
		t.Errorf("approved requirements not merged at tag: %v", keys(sent.Files))
	}
	if sent.Files["specs/requirements/domain.dsl"] != "dsl" {
		t.Errorf("approved .dsl not merged: %v", keys(sent.Files))
	}
	if _, ok := sent.Files["specs/requirements/scene.excalidraw"]; ok {
		t.Error("excalidraw merged from tag (should be filtered)")
	}
	// Core design skills pushed with references intact.
	if hla := findSkill(sent.Skills, "high-level-architecture"); hla == nil {
		t.Error("high-level-architecture not pushed for design-generate")
	}
	wf := findSkill(sent.Skills, "excalidraw-wireframes")
	if wf == nil || len(wf.References) == 0 {
		t.Errorf("excalidraw-wireframes references not intact: %+v", wf)
	}
	oa := findSkill(sent.Skills, "openapi-conventions")
	if oa == nil || len(oa.References) == 0 {
		t.Errorf("openapi-conventions references not intact: %+v", oa)
	}
}

func TestTurn_NoAnthropicKey_PreStream4xx(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	r.key = "" // org has no key
	rec := r.turn(useCaseRequirementsGenerate(), map[string]string{"specs/requirements/requirements.md": "x"})
	if rec.Code < 400 || rec.Code >= 500 {
		t.Fatalf("missing key: code %d, want 4xx", rec.Code)
	}
	if r.fake.turnCount != 0 {
		t.Error("agents service called despite missing Anthropic key")
	}
}

// ---- passthrough + error mapping ----

func TestTurn_SSEVerbatimPassthrough(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	rec := r.turn(useCaseRequirementsGenerate(), map[string]string{"specs/requirements/requirements.md": "x"})
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d", rec.Code)
	}
	if rec.Body.String() != cannedSSE {
		t.Errorf("stream not verbatim:\n got %q\nwant %q", rec.Body.String(), cannedSSE)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestTurn_ErrorMapping(t *testing.T) {
	cases := []struct {
		upstream int
		want     int
		bodyHas  string
	}{
		{http.StatusConflict, http.StatusConflict, "turn_in_progress"},
		{http.StatusRequestEntityTooLarge, http.StatusRequestEntityTooLarge, ""},
		{http.StatusInternalServerError, http.StatusBadGateway, ""},
		{http.StatusBadRequest, http.StatusBadGateway, ""},
	}
	for _, c := range cases {
		r := newGenaiRig(t, nil, false)
		r.fake.turnStatus = c.upstream
		r.fake.turnBody = `{"error":"upstream"}`
		rec := r.turn(useCaseRequirementsGenerate(), map[string]string{"specs/requirements/requirements.md": "x"})
		if rec.Code != c.want {
			t.Errorf("upstream %d → %d, want %d (%s)", c.upstream, rec.Code, c.want, rec.Body.String())
		}
		if c.bodyHas != "" && !strings.Contains(rec.Body.String(), c.bodyHas) {
			t.Errorf("upstream %d body = %s, want contains %q", c.upstream, rec.Body.String(), c.bodyHas)
		}
	}
}

func TestTurn_InvalidUseCase_400(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	body := `{"useCase":"bogus","instruction":"x","files":{}}`
	rec := r.h.AsOrg(testOrg).Post(turnPath(convUUID), body)
	if rec.Code != http.StatusUnprocessableEntity && rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid useCase: code %d, want 4xx", rec.Code)
	}
}

func TestTurn_InvalidConversationID_400(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	// "a--b" contains the namespace separator → rejected.
	rec := r.turn2("a--b", useCaseRequirementsGenerate(), map[string]string{"specs/requirements/requirements.md": "x"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad conv id: code %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

func (r *genaiRig) turn2(uuid, useCase string, files map[string]string) *httptest.ResponseRecorder {
	body := map[string]any{"useCase": useCase, "instruction": "x", "files": files}
	b, _ := json.Marshal(body)
	return r.h.AsOrg(testOrg).Post(turnPath(uuid), string(b))
}

// ---- rehydrate ----

func TestRehydrate_ChatMessages(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	rec := r.h.AsOrg(testOrg).Get(convPath(convUUID))
	if rec.Code != http.StatusOK {
		t.Fatalf("rehydrate code %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"messages"`) {
		t.Errorf("rehydrate body = %s", rec.Body.String())
	}
	// Rehydrate reconstructs the id under the requirements-chat use case.
	wantPrefix := "/conversations/org_" + testOrg + "--proj_" + testProj + "--requirements-chat--" + convUUID
	if r.fake.lastConvPath != wantPrefix {
		t.Errorf("rehydrate path = %q, want %q", r.fake.lastConvPath, wantPrefix)
	}
}

func TestRehydrate_CrossTenantOrUnknown_404(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	// An id the service does not have (a cross-tenant uuid namespaces to a
	// different id that this scope has never created) → 404.
	r.fake.convStatus = http.StatusNotFound
	rec := r.h.AsOrg(testOrg).Get(convPath(convUUID))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown conversation: code %d, want 404", rec.Code)
	}
}

func TestGenAI_NoAuth_401(t *testing.T) {
	r := newGenaiRig(t, nil, false)
	if rec := r.h.NoAuth().Get(convPath(convUUID)); rec.Code != http.StatusUnauthorized {
		t.Errorf("no-auth rehydrate: code %d, want 401", rec.Code)
	}
}

// ---- helpers ----

func findSkill(skills []agentsvc.Skill, name string) *agentsvc.Skill {
	for i := range skills {
		if skills[i].Name == name {
			return &skills[i]
		}
	}
	return nil
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// use-case string accessors (kept local so the test reads intent, not literals).
func useCaseRequirementsGenerate() string { return "requirements-generate" }
func useCaseRequirementsChat() string     { return "requirements-chat" }
func useCaseDesignGenerate() string       { return "design-generate" }
