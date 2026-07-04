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

// UNIT tier (bff-component-testing.md §2): the REAL designService with every
// out-of-process seam faked — the artifact service (wrapped by the REAL
// artifacts.NewArtifactStore decorator, so the store's split/assemble logic
// runs for real), the agents client (an interface — hand-faked at the method
// boundary, no httptest needed), and the three inline consumer ports
// (taskReconciler, traitSyncReconciler, skillCatalog). No HTTP, no DB — design
// has no SQL-shaped behavior (persistence delegates to artifacts/git), so there
// is no dbtest tier for this feature.
//
// This file proves the service's logic branches: the design assembly + status
// projection, the versioning map, the ErrSpecNotApproved generation gate, the
// StreamGenerateDesign completion + persisted-artifact side-effect, and — the
// load-bearing part — that each of the three ports is invoked at the right
// point with the right args, and that a nil port (setter never called) never
// panics where production tolerates it. The HTTP contract (status codes,
// validation, error mapping, the gate 401) lives in design_component_test.go.
package design

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/models"
)

// --- fakes -------------------------------------------------------------------

// fakeAgentsClient hand-fakes agents.Client (an interface — the out-of-process
// boundary is the HTTP call inside the real client, not this seam). Only
// StreamArchitect is exercised by design; the rest panic loudly. The last
// request is captured so tests can assert the input assembly (skills, previous
// design, wireframes) the service built.
type fakeAgentsClient struct {
	streamArchitect func(ctx context.Context, orgID string, req agents.ArchitectRequest) (io.ReadCloser, error)
	lastOrg         string
	lastReq         agents.ArchitectRequest
	architectCalls  int
}

func (f *fakeAgentsClient) StreamArchitect(ctx context.Context, orgID string, req agents.ArchitectRequest) (io.ReadCloser, error) {
	f.architectCalls++
	f.lastOrg = orgID
	f.lastReq = req
	if f.streamArchitect == nil {
		panic("fakeAgentsClient: StreamArchitect func not set")
	}
	return f.streamArchitect(ctx, orgID, req)
}
func (f *fakeAgentsClient) StreamDocumentGeneration(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
	panic("fakeAgentsClient: StreamDocumentGeneration not expected")
}
func (f *fakeAgentsClient) StreamTechLeadPlan(context.Context, string, agents.TechLeadPlanRequest) (io.ReadCloser, error) {
	panic("fakeAgentsClient: StreamTechLeadPlan not expected")
}
func (f *fakeAgentsClient) StreamTechLeadDetail(context.Context, string, agents.TechLeadDetailRequest) (io.ReadCloser, error) {
	panic("fakeAgentsClient: StreamTechLeadDetail not expected")
}
func (f *fakeAgentsClient) StreamRequirementsChat(context.Context, string, agents.RequirementsChatRequest) (io.ReadCloser, error) {
	panic("fakeAgentsClient: StreamRequirementsChat not expected")
}
func (f *fakeAgentsClient) RenderDsl(context.Context, string, string) (string, error) {
	panic("fakeAgentsClient: RenderDsl not expected")
}

var _ agents.Client = (*fakeAgentsClient)(nil)

// portCall records the (org, project, extra) args a consumer port saw.
type portCall struct {
	org, project, extra string
}

// fakeTaskReconciler records ReconcilePendingForDesignChange invocations.
type fakeTaskReconciler struct {
	calls []portCall
	err   error
}

func (f *fakeTaskReconciler) ReconcilePendingForDesignChange(_ context.Context, orgID, projectID string) error {
	f.calls = append(f.calls, portCall{org: orgID, project: projectID})
	return f.err
}

// fakeTraitSync records SyncComponentTraits / DeleteComponentCascade calls.
type fakeTraitSync struct {
	syncCalls   []portCall
	deleteCalls []portCall
	syncErr     error
	deleteErr   error
}

func (f *fakeTraitSync) SyncComponentTraits(_ context.Context, orgID, projectID, componentName string) error {
	f.syncCalls = append(f.syncCalls, portCall{org: orgID, project: projectID, extra: componentName})
	return f.syncErr
}
func (f *fakeTraitSync) DeleteComponentCascade(_ context.Context, orgID, projectID, componentName string) error {
	f.deleteCalls = append(f.deleteCalls, portCall{org: orgID, project: projectID, extra: componentName})
	return f.deleteErr
}

// fakeSkillCatalog records List and returns a canned per-org catalogue.
type fakeSkillCatalog struct {
	calls  int
	lastCt string
	skills []models.Skill
	err    error
}

func (f *fakeSkillCatalog) List(_ context.Context, orgID string) ([]models.Skill, error) {
	f.calls++
	f.lastCt = orgID
	return f.skills, f.err
}

// --- fixtures ----------------------------------------------------------------

// validDesignFiles is a well-formed working-tree map that AssembleDesign
// accepts: a root design.md (frontmatter carrying sourceSpec) plus one service
// component with a design.md + openapi.yaml. Mirrors the harvested golden shape.
func validDesignFiles() map[string]string {
	return map[string]string{
		artifacts.DesignRootFile:            "---\nsourceSpec: v1\n---\n\nOverview prose here.\n",
		"components/hello-api/design.md":    "---\ntype: service\nlanguage: Go\n---\n\n# hello-api\n\nBuild it.\n",
		"components/hello-api/openapi.yaml": "openapi: 3.0.3\n",
	}
}

// newService builds the REAL designService over the given fake artifact service,
// wrapping it in the REAL ArtifactStore decorator. agentsClient may be nil for
// tests that never generate.
func newService(fake *artifactstest.FakeArtifactService, agentsClient agents.Client) *designService {
	return &designService{
		store:        artifacts.NewArtifactStore(fake),
		agentsClient: agentsClient,
		artifactSvc:  fake,
	}
}

// sseFinish builds a minimal AI-SDK UI message stream whose data-finish frame
// carries the given design. The service forwards every line downstream and
// harvests the finish frame for persistence.
func sseFinish(overview string, components ...models.DesignComponent) io.ReadCloser {
	var sb strings.Builder
	sb.WriteString("data: {\"type\":\"start\"}\n")
	frame := agents.ArchitectDesign{Overview: overview, Components: components}
	// Hand-encode the data-finish envelope so the exact wire shape the service
	// parses (type + data.design) is what the test asserts against.
	envelope, err := json.Marshal(map[string]any{
		"type": "data-finish",
		"data": map[string]any{"design": frame},
	})
	if err != nil {
		panic(err)
	}
	sb.WriteString("data: ")
	sb.Write(envelope)
	sb.WriteString("\n")
	sb.WriteString("data: [DONE]\n")
	return io.NopCloser(strings.NewReader(sb.String()))
}

// mapValues returns a map's values in unspecified order — used to search the
// captured write set for expected content.
func mapValues(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

// --- GetDesign ---------------------------------------------------------------

func TestGetDesign_NoDesignYet(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil // empty tree → ReadDesign returns nil,nil
		},
	}
	d, err := newService(fake, nil).GetDesign(context.Background(), "acme", "web")
	if err != nil || d != nil {
		t.Fatalf("no design: want (nil,nil), got (%v,%v)", d, err)
	}
}

func TestGetDesign_NotFoundIsEmptyNotError(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return nil, artifacts.ErrArtifactNotFound
		},
	}
	d, err := newService(fake, nil).GetDesign(context.Background(), "acme", "web")
	if err != nil || d != nil {
		t.Fatalf("NotFound must degrade to (nil,nil), got (%v,%v)", d, err)
	}
}

func TestGetDesign_ApprovedWithVersions(t *testing.T) {
	t.Parallel()
	files := validDesignFiles()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1, CommitHash: "abc"}}, nil
		},
		// unsaved-changes compares the working tree against the tagged files;
		// identical → not unsaved.
		GetDesignAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
	}
	d, err := newService(fake, nil).GetDesign(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("GetDesign: %v", err)
	}
	if d.Status != "approved" || d.Version != 1 || len(d.Versions) != 1 {
		t.Fatalf("status projection: status=%q version=%d versions=%d", d.Status, d.Version, len(d.Versions))
	}
	if d.SourceSpec != "v1" {
		t.Fatalf("sourceSpec: got %q, want v1 (from the design.md frontmatter)", d.SourceSpec)
	}
	if d.HasUnsavedChanges {
		t.Fatal("working tree equals the tag → HasUnsavedChanges must be false")
	}
	if len(d.Components) != 1 || d.Components[0].Name != "hello-api" {
		t.Fatalf("components not assembled: %+v", d.Components)
	}
}

func TestGetDesign_UnsavedWhenTreeDiffersFromTag(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1}}, nil
		},
		GetDesignAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return map[string]string{artifacts.DesignRootFile: "different\n"}, nil
		},
	}
	d, err := newService(fake, nil).GetDesign(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("GetDesign: %v", err)
	}
	if !d.HasUnsavedChanges {
		t.Fatal("working tree differs from the tag → HasUnsavedChanges must be true")
	}
}

func TestGetDesign_NoVersionsIsDraftAndUnsaved(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil // never tagged
		},
	}
	d, err := newService(fake, nil).GetDesign(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("GetDesign: %v", err)
	}
	// No tag → draft, and any working-tree content is by definition unsaved.
	if d.Status != "draft" || d.Version != 0 || !d.HasUnsavedChanges {
		t.Fatalf("untagged design: status=%q version=%d unsaved=%v", d.Status, d.Version, d.HasUnsavedChanges)
	}
}

// --- GetDesignAtTag ----------------------------------------------------------

func TestGetDesignAtTag_NilClientErrors(t *testing.T) {
	t.Parallel()
	s := &designService{artifactSvc: nil}
	if _, err := s.GetDesignAtTag(context.Background(), "acme", "web", "v1-1"); err == nil {
		t.Fatal("nil artifact client must error")
	}
}

func TestGetDesignAtTag_NotFoundMapsToDesignNotFound(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		GetDesignAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return nil, artifacts.ErrArtifactNotFound
		},
	}
	_, err := newService(fake, nil).GetDesignAtTag(context.Background(), "acme", "web", "v1-1")
	if !errors.Is(err, artifacts.ErrDesignNotFound) {
		t.Fatalf("want ErrDesignNotFound, got %v", err)
	}
}

func TestGetDesignAtTag_HappyDecodesParentFromTag(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		GetDesignAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
	}
	d, err := newService(fake, nil).GetDesignAtTag(context.Background(), "acme", "web", "v3-2")
	if err != nil {
		t.Fatalf("GetDesignAtTag: %v", err)
	}
	if d.Status != "approved" || d.SourceSpec != "v3" {
		t.Fatalf("tag decode: status=%q sourceSpec=%q (want approved / v3)", d.Status, d.SourceSpec)
	}
}

// --- GetDesignBundle / AtTag -------------------------------------------------

func TestGetDesignBundle_PairsFilesAndDesign(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	b, err := newService(fake, nil).GetDesignBundle(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("GetDesignBundle: %v", err)
	}
	if len(b.Files) == 0 || b.Design == nil || len(b.Design.Components) != 1 {
		t.Fatalf("bundle must pair the raw file map with the assembled design: %+v", b)
	}
}

func TestGetDesignBundleAtTag_NilClientErrors(t *testing.T) {
	t.Parallel()
	s := &designService{artifactSvc: nil}
	if _, err := s.GetDesignBundleAtTag(context.Background(), "acme", "web", "v1-1"); err == nil {
		t.Fatal("nil artifact client must error")
	}
}

func TestGetDesignBundleAtTag_Happy(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		GetDesignAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
	}
	b, err := newService(fake, nil).GetDesignBundleAtTag(context.Background(), "acme", "web", "v1-1")
	if err != nil {
		t.Fatalf("GetDesignBundleAtTag: %v", err)
	}
	if len(b.Files) == 0 || b.Design == nil {
		t.Fatalf("bundle-at-tag must carry files + design: %+v", b)
	}
}

// --- StreamGenerateDesign: the ErrSpecNotApproved gate + side effects --------

func TestStreamGenerate_NoRequirementsIsSpecNotFound(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil // no requirements yet
		},
	}
	err := newService(fake, &fakeAgentsClient{}).StreamGenerateDesign(context.Background(), "acme", "web", &bytes.Buffer{}, func() {})
	if !errors.Is(err, artifacts.ErrSpecNotFound) {
		t.Fatalf("want ErrSpecNotFound, got %v", err)
	}
}

func TestStreamGenerate_UnapprovedSpecIsGated(t *testing.T) {
	t.Parallel()
	// Requirements files EXIST but were never tagged (no approved version).
	// The gate returns the design-domain ErrSpecNotApproved sentinel (409 at
	// the edge) BEFORE any call to the agents service.
	agentsClient := &fakeAgentsClient{}
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# Reqs\n\nBuild X."}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return nil, nil // never approved
		},
	}
	err := newService(fake, agentsClient).StreamGenerateDesign(context.Background(), "acme", "web", &bytes.Buffer{}, func() {})
	if !errors.Is(err, ErrSpecNotApproved) {
		t.Fatalf("want ErrSpecNotApproved, got %v", err)
	}
	if agentsClient.architectCalls != 0 {
		t.Fatal("the gate must short-circuit before calling the agents service")
	}
}

func TestStreamGenerate_HappyPersistsAndConsultsSkillCatalog(t *testing.T) {
	t.Parallel()
	written := map[string]string{}
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# Reqs\n\nBuild X."}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil // no prior design
		},
		PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
			written[relPath] = content
			return &artifacts.PutResult{SHA: "sha"}, nil
		},
	}
	agentsClient := &fakeAgentsClient{
		streamArchitect: func(context.Context, string, agents.ArchitectRequest) (io.ReadCloser, error) {
			return sseFinish("Generated overview", models.DesignComponent{
				Name: "svc-a", ComponentType: "service", Language: "Go", Dependencies: []models.Dependency{},
			}), nil
		},
	}
	skills := &fakeSkillCatalog{skills: []models.Skill{
		{Name: "go", Kind: "builtin", Description: "Go skill", SkillMD: "# Go"},
		{Name: "corp-style", Kind: "custom", Description: "House style"},
	}}

	svc := newService(fake, agentsClient)
	svc.SetSkillService(skills)

	var out bytes.Buffer
	if err := svc.StreamGenerateDesign(context.Background(), "acme", "web", &out, func() {}); err != nil {
		t.Fatalf("StreamGenerateDesign: %v", err)
	}

	// (1) The upstream SSE was forwarded verbatim to the caller.
	if !strings.Contains(out.String(), "data-finish") {
		t.Fatalf("stream not forwarded downstream: %q", out.String())
	}
	// (2) The finished design was PERSISTED via the store (the observable side
	// effect the SSE rule cares about) — root overview + the component subtree.
	all := strings.Join(mapValues(written), "\n")
	if !strings.Contains(all, "Generated overview") || !strings.Contains(all, "svc-a") {
		t.Fatalf("finished design not persisted: %v", written)
	}
	// (3) The skill catalogue was consulted for the acting org and its records
	// flowed into the architect input assembly (builtin body + org manifest).
	if skills.calls != 1 || skills.lastCt != "acme" {
		t.Fatalf("skill catalogue not consulted for org acme: calls=%d org=%q", skills.calls, skills.lastCt)
	}
	if len(agentsClient.lastReq.BuiltinSkills) != 1 || agentsClient.lastReq.BuiltinSkills[0].Name != "go" {
		t.Fatalf("builtin skill body not inlined into architect input: %+v", agentsClient.lastReq.BuiltinSkills)
	}
	if len(agentsClient.lastReq.OrgSkills) != 1 || agentsClient.lastReq.OrgSkills[0].Name != "corp-style" {
		t.Fatalf("org skill manifest not attached to architect input: %+v", agentsClient.lastReq.OrgSkills)
	}
}

func TestStreamGenerate_NilSkillCatalogDoesNotPanic(t *testing.T) {
	t.Parallel()
	written := map[string]string{}
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# Reqs"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil
		},
		PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
			written[relPath] = content
			return &artifacts.PutResult{SHA: "sha"}, nil
		},
	}
	agentsClient := &fakeAgentsClient{
		streamArchitect: func(context.Context, string, agents.ArchitectRequest) (io.ReadCloser, error) {
			return sseFinish("Overview", models.DesignComponent{Name: "svc-a", ComponentType: "service"}), nil
		},
	}
	// No SetSkillService — skillSvc stays nil (pre-skills behaviour).
	svc := newService(fake, agentsClient)
	if err := svc.StreamGenerateDesign(context.Background(), "acme", "web", &bytes.Buffer{}, func() {}); err != nil {
		t.Fatalf("nil skill catalogue must run with no skills, got: %v", err)
	}
	if len(agentsClient.lastReq.BuiltinSkills) != 0 || len(agentsClient.lastReq.OrgSkills) != 0 {
		t.Fatalf("nil catalogue must attach no skills: %+v", agentsClient.lastReq)
	}
}

func TestStreamGenerate_RemovedComponentDirsAreDeleted(t *testing.T) {
	t.Parallel()
	// A component present in the working tree but absent from the freshly
	// generated design must have its components/<name>/ subtree deleted.
	deletedDirs := []string{}
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# Reqs"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			// Prior tree has "old-svc"; the new design only has "svc-a".
			return map[string]string{
				artifacts.DesignRootFile:       "old\n",
				"components/old-svc/design.md": "---\ntype: service\n---\n\n# old-svc\n",
				"components/svc-a/design.md":   "---\ntype: service\n---\n\n# svc-a\n",
			}, nil
		},
		DeleteDesignDirectoryFunc: func(_ context.Context, _, _, sub string) error {
			deletedDirs = append(deletedDirs, sub)
			return nil
		},
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return &artifacts.PutResult{SHA: "sha"}, nil
		},
	}
	agentsClient := &fakeAgentsClient{
		streamArchitect: func(context.Context, string, agents.ArchitectRequest) (io.ReadCloser, error) {
			return sseFinish("Overview", models.DesignComponent{Name: "svc-a", ComponentType: "service"}), nil
		},
	}
	if err := newService(fake, agentsClient).StreamGenerateDesign(context.Background(), "acme", "web", &bytes.Buffer{}, func() {}); err != nil {
		t.Fatalf("StreamGenerateDesign: %v", err)
	}
	if len(deletedDirs) != 1 || !strings.Contains(deletedDirs[0], "old-svc") {
		t.Fatalf("removed component dir not GC'd: %v", deletedDirs)
	}
}

func TestStreamGenerate_StreamWithoutFinishErrors(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# Reqs"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Tag: "v1", Version: 1}}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil
		},
	}
	agentsClient := &fakeAgentsClient{
		streamArchitect: func(context.Context, string, agents.ArchitectRequest) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("data: {\"type\":\"start\"}\ndata: [DONE]\n")), nil
		},
	}
	err := newService(fake, agentsClient).StreamGenerateDesign(context.Background(), "acme", "web", &bytes.Buffer{}, func() {})
	if err == nil || !strings.Contains(err.Error(), "without finishing") {
		t.Fatalf("a stream that never finishes must error, got %v", err)
	}
}

// --- UpdateDesignFile: the trait-sync port -----------------------------------

func TestUpdateDesignFile_ComponentDesignFiresTraitSync(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return &artifacts.PutResult{SHA: "sha"}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	trait := &fakeTraitSync{}
	svc := newService(fake, nil)
	svc.SetTraitSync(trait)

	if _, err := svc.UpdateDesignFile(context.Background(), "acme", "web", "components/Hello API/design.md", "new"); err != nil {
		t.Fatalf("UpdateDesignFile: %v", err)
	}
	if len(trait.syncCalls) != 1 {
		t.Fatalf("component design.md edit must fire SyncComponentTraits once, got %d", len(trait.syncCalls))
	}
	c := trait.syncCalls[0]
	// Args must carry the acting org/project and the k8s-normalised component name.
	if c.org != "acme" || c.project != "web" || c.extra != toK8sName("Hello API") {
		t.Fatalf("trait sync args: %+v (want acme/web/%s)", c, toK8sName("Hello API"))
	}
}

func TestUpdateDesignFile_RootDesignDoesNotFireTraitSync(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return &artifacts.PutResult{SHA: "sha"}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	trait := &fakeTraitSync{}
	svc := newService(fake, nil)
	svc.SetTraitSync(trait)

	// Editing the root design.md is not a per-component edit → no trait sync.
	if _, err := svc.UpdateDesignFile(context.Background(), "acme", "web", "design.md", "prose"); err != nil {
		t.Fatalf("UpdateDesignFile: %v", err)
	}
	if len(trait.syncCalls) != 0 {
		t.Fatalf("root design.md edit must NOT fire trait sync, got %d calls", len(trait.syncCalls))
	}
}

func TestUpdateDesignFile_NilTraitSyncDoesNotPanic(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return &artifacts.PutResult{SHA: "sha"}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	// No SetTraitSync — production tolerates a nil port on this best-effort hook.
	svc := newService(fake, nil)
	if _, err := svc.UpdateDesignFile(context.Background(), "acme", "web", "components/svc/design.md", "x"); err != nil {
		t.Fatalf("nil traitSync must be a no-op, got: %v", err)
	}
}

func TestUpdateDesignFile_TraitSyncFailureIsBestEffort(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return &artifacts.PutResult{SHA: "sha"}, nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	trait := &fakeTraitSync{syncErr: errors.New("OC unreachable")}
	svc := newService(fake, nil)
	svc.SetTraitSync(trait)
	// A trait-sync failure must never bubble — the design tree is canonical.
	if _, err := svc.UpdateDesignFile(context.Background(), "acme", "web", "components/svc/design.md", "x"); err != nil {
		t.Fatalf("trait sync failure must be swallowed, got: %v", err)
	}
}

// --- DeleteComponent: the cascade port ---------------------------------------

func TestDeleteComponent_EmptyNameGuard(t *testing.T) {
	t.Parallel()
	svc := newService(&artifactstest.FakeArtifactService{}, nil)
	if _, err := svc.DeleteComponent(context.Background(), "acme", "web", ""); err == nil {
		t.Fatal("empty component name must error before any store call")
	}
}

func TestDeleteComponent_FiresCascadeWithK8sName(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		DeleteDesignDirectoryFunc: func(context.Context, string, string, string) error { return nil },
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	trait := &fakeTraitSync{}
	svc := newService(fake, nil)
	svc.SetTraitSync(trait)

	if _, err := svc.DeleteComponent(context.Background(), "acme", "web", "Hello API"); err != nil {
		t.Fatalf("DeleteComponent: %v", err)
	}
	if len(trait.deleteCalls) != 1 {
		t.Fatalf("delete must fire the OC cascade once, got %d", len(trait.deleteCalls))
	}
	c := trait.deleteCalls[0]
	if c.org != "acme" || c.project != "web" || c.extra != toK8sName("Hello API") {
		t.Fatalf("cascade args: %+v (want acme/web/%s)", c, toK8sName("Hello API"))
	}
}

func TestDeleteComponent_NilTraitSyncDoesNotPanic(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		DeleteDesignDirectoryFunc: func(context.Context, string, string, string) error { return nil },
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	svc := newService(fake, nil) // no SetTraitSync
	if _, err := svc.DeleteComponent(context.Background(), "acme", "web", "svc"); err != nil {
		t.Fatalf("nil traitSync must be a no-op, got: %v", err)
	}
}

// --- DeleteDesignFile --------------------------------------------------------

func TestDeleteDesignFile_DelegatesAndRefreshes(t *testing.T) {
	t.Parallel()
	deleted := ""
	fake := &artifactstest.FakeArtifactService{
		DeleteDesignFileFunc: func(_ context.Context, _, _, sub string) error {
			deleted = sub
			return nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	b, err := newService(fake, nil).DeleteDesignFile(context.Background(), "acme", "web", "components/svc/openapi.yaml")
	if err != nil {
		t.Fatalf("DeleteDesignFile: %v", err)
	}
	if deleted != "components/svc/openapi.yaml" || b == nil {
		t.Fatalf("delete must delegate the sub-path and return the refreshed bundle: deleted=%q b=%v", deleted, b)
	}
}

// --- SaveAndProceed: the task-reconcile port ---------------------------------

func TestSaveAndProceed_NilClientErrors(t *testing.T) {
	t.Parallel()
	s := &designService{artifactSvc: nil}
	if _, err := s.SaveAndProceed(context.Background(), "acme", "web"); err == nil {
		t.Fatal("nil artifact client must error")
	}
}

func TestSaveAndProceed_NoDesignIsNotFound(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil // nothing to save
		},
	}
	_, err := newService(fake, nil).SaveAndProceed(context.Background(), "acme", "web")
	if !errors.Is(err, artifacts.ErrDesignNotFound) {
		t.Fatalf("want ErrDesignNotFound, got %v", err)
	}
}

func TestSaveAndProceed_NoBaselineTranslatesToSpecNotApproved(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		SaveDesignFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.DesignSaveResult, error) {
			// The git service refuses when there is no requirements baseline.
			return nil, errors.New("save failed: no requirements baseline exists")
		},
	}
	_, err := newService(fake, nil).SaveAndProceed(context.Background(), "acme", "web")
	if !errors.Is(err, ErrSpecNotApproved) {
		t.Fatalf("no-baseline must translate to ErrSpecNotApproved, got %v", err)
	}
}

func TestSaveAndProceed_HappyReconcilesTasks(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		SaveDesignFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.DesignSaveResult, error) {
			return &artifacts.DesignSaveResult{Status: "approved", Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1}, nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1}}, nil
		},
	}
	task := &fakeTaskReconciler{}
	svc := newService(fake, nil)
	svc.SetTaskService(task)

	d, err := svc.SaveAndProceed(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("SaveAndProceed: %v", err)
	}
	if d.Status != "approved" || d.Version != 1 || d.SourceSpec != "v1" {
		t.Fatalf("save projection: status=%q version=%d sourceSpec=%q", d.Status, d.Version, d.SourceSpec)
	}
	// A design change on save reconciles pending tasks for the acting project.
	if len(task.calls) != 1 || task.calls[0].org != "acme" || task.calls[0].project != "web" {
		t.Fatalf("task reconcile not fired with the right args: %+v", task.calls)
	}
}

func TestSaveAndProceed_NilTaskReconcilerDoesNotPanic(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		SaveDesignFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.DesignSaveResult, error) {
			return &artifacts.DesignSaveResult{Status: "approved", Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1}, nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	svc := newService(fake, nil) // no SetTaskService
	if _, err := svc.SaveAndProceed(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("nil task reconciler must be a no-op, got: %v", err)
	}
}

func TestSaveAndProceed_ReconcileFailureIsBestEffort(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		SaveDesignFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.DesignSaveResult, error) {
			return &artifacts.DesignSaveResult{Status: "approved", Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1}, nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	task := &fakeTaskReconciler{err: errors.New("reconcile boom")}
	svc := newService(fake, nil)
	svc.SetTaskService(task)
	// The save succeeded; a reconcile failure is logged, never surfaced.
	if _, err := svc.SaveAndProceed(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("reconcile failure must not fail the save, got: %v", err)
	}
}

// --- DiscardChanges ----------------------------------------------------------

func TestDiscardChanges_NilClientErrors(t *testing.T) {
	t.Parallel()
	s := &designService{artifactSvc: nil}
	if _, err := s.DiscardChanges(context.Background(), "acme", "web"); err == nil {
		t.Fatal("nil artifact client must error")
	}
}

func TestDiscardChanges_NothingToRevert(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		DiscardDesignFunc: func(context.Context, string, string) (map[string]string, error) {
			return nil, artifacts.ErrArtifactNotFound
		},
	}
	_, err := newService(fake, nil).DiscardChanges(context.Background(), "acme", "web")
	if err == nil || !strings.Contains(err.Error(), "no saved version") {
		t.Fatalf("want a no-saved-version error, got %v", err)
	}
}

func TestDiscardChanges_HappyReturnsCurrentDesign(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		DiscardDesignFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return validDesignFiles(), nil
		},
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return nil, nil
		},
	}
	d, err := newService(fake, nil).DiscardChanges(context.Background(), "acme", "web")
	if err != nil || d == nil {
		t.Fatalf("discard must return the reverted design: d=%v err=%v", d, err)
	}
}

// --- ListDesignVersions ------------------------------------------------------

func TestListDesignVersions_NilClientReturnsNil(t *testing.T) {
	t.Parallel()
	s := &designService{artifactSvc: nil}
	v, err := s.ListDesignVersions(context.Background(), "acme", "web")
	if err != nil || v != nil {
		t.Fatalf("nil client → (nil,nil), got (%v,%v)", v, err)
	}
}

func TestListDesignVersions_MapsThrough(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignVersionsFunc: func(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v2-3", RequirementsVersion: 2, DesignRevision: 3, CommitHash: "h"}}, nil
		},
	}
	v, err := newService(fake, nil).ListDesignVersions(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("ListDesignVersions: %v", err)
	}
	if len(v) != 1 || v[0].TagName != "v2-3" || v[0].Version != 3 || v[0].SourceSpec != "v2" {
		t.Fatalf("version mapping drifted: %+v", v)
	}
}

// --- versioning.go: mapDesignVersions ---------------------------------------

func TestMapDesignVersions(t *testing.T) {
	t.Parallel()
	if got := mapDesignVersions(nil); got != nil {
		t.Fatalf("empty input must map to nil, got %v", got)
	}
	got := mapDesignVersions([]artifacts.DesignVersionInfo{
		{Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1, CommitHash: "a"},
		{Tag: "v2-5", RequirementsVersion: 2, DesignRevision: 5, CommitHash: "b"},
	})
	if len(got) != 2 {
		t.Fatalf("want 2 rows, got %d", len(got))
	}
	// Version carries the design revision (M); SourceSpec is the parent
	// requirements tag (v<N>) so the UI renders lineage without re-parsing.
	if got[0].Version != 1 || got[0].TagName != "v1-1" || got[0].CommitHash != "a" || got[0].SourceSpec != "v1" {
		t.Fatalf("row 0 drifted: %+v", got[0])
	}
	if got[1].Version != 5 || got[1].SourceSpec != "v2" {
		t.Fatalf("row 1 drifted: %+v", got[1])
	}
}

// --- mapDesignError (both branches, exhaustively) ----------------------------

func TestMapDesignError(t *testing.T) {
	t.Parallel()
	assertStatus := func(t *testing.T, err error, want int) {
		t.Helper()
		var se huma.StatusError
		if !errors.As(err, &se) {
			t.Fatalf("mapDesignError must return a huma StatusError, got %T", err)
		}
		if se.GetStatus() != want {
			t.Fatalf("status: got %d want %d", se.GetStatus(), want)
		}
	}
	assertStatus(t, mapDesignError(artifacts.ErrDesignNotFound), 404)
	assertStatus(t, mapDesignError(errors.New("pg: connection refused")), 500)
	// The opaque 500 must not leak the internal cause.
	if strings.Contains(mapDesignError(errors.New("pg: connection refused")).Error(), "connection refused") {
		t.Fatal("opaque 500 must not leak internals")
	}
}

// --- pure helpers ------------------------------------------------------------

func TestDecodeDesignTag(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in     string
		wantN  int
		wantR  int
		wantOK bool
	}{
		{"v1-2", 1, 2, true},
		{"v10-3", 10, 3, true},
		{"v1", 0, 0, false},
		{"v0-1", 0, 0, false}, // N must be >= 1
		{"v1-0", 0, 0, false}, // M must be >= 1
		{"garbage", 0, 0, false},
		{"", 0, 0, false},
	}
	for _, c := range cases {
		n, r, ok := decodeDesignTag(c.in)
		if n != c.wantN || r != c.wantR || ok != c.wantOK {
			t.Errorf("decodeDesignTag(%q) = (%d,%d,%v), want (%d,%d,%v)", c.in, n, r, ok, c.wantN, c.wantR, c.wantOK)
		}
	}
}

func TestAssembleDesignFromFiles(t *testing.T) {
	t.Parallel()
	if _, err := AssembleDesignFromFiles(map[string]string{}); err == nil {
		t.Fatal("empty file map must error")
	}
	d, err := AssembleDesignFromFiles(validDesignFiles())
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	if len(d.Components) != 1 || d.Components[0].Name != "hello-api" {
		t.Fatalf("assembled design drifted: %+v", d)
	}
}

func TestSeedDefaultSkillsApplied(t *testing.T) {
	t.Parallel()
	// Non-empty current set is preserved (sorted), builtins ignored.
	got := seedDefaultSkillsApplied([]string{"b", "a"}, []agents.SkillRecord{{Name: "go"}})
	if strings.Join(got, ",") != "a,b" {
		t.Fatalf("current set must win, sorted: %v", got)
	}
	// Empty current → stamp every builtin, sorted.
	got = seedDefaultSkillsApplied(nil, []agents.SkillRecord{{Name: "go"}, {Name: "api-management"}})
	if strings.Join(got, ",") != "api-management,go" {
		t.Fatalf("empty current must seed builtins, sorted: %v", got)
	}
}

func TestResolveArchitectSkills(t *testing.T) {
	t.Parallel()
	// Nil catalogue → no skills, no error.
	if b, o := newService(&artifactstest.FakeArtifactService{}, nil).resolveArchitectSkills(context.Background(), "acme"); b != nil || o != nil {
		t.Fatalf("nil catalogue must return (nil,nil), got (%v,%v)", b, o)
	}
	// Builtins carry full bodies; everything else is a description-only manifest.
	skills := &fakeSkillCatalog{skills: []models.Skill{
		{Name: "go", Kind: "builtin", Description: "d1", SkillMD: "# body"},
		{Name: "custom-a", Kind: "custom", Description: "d2"},
		{Name: "imported-b", Kind: "imported", Description: "d3"},
	}}
	svc := newService(&artifactstest.FakeArtifactService{}, nil)
	svc.SetSkillService(skills)
	builtins, org := svc.resolveArchitectSkills(context.Background(), "acme")
	if len(builtins) != 1 || builtins[0].Name != "go" || builtins[0].Body != "# body" {
		t.Fatalf("builtin split drifted: %+v", builtins)
	}
	if len(org) != 2 {
		t.Fatalf("custom+imported must land in the org manifest, got %+v", org)
	}
}

func TestResolveArchitectSkills_ListErrorDegradesToNoSkills(t *testing.T) {
	t.Parallel()
	skills := &fakeSkillCatalog{err: errors.New("skills service down")}
	svc := newService(&artifactstest.FakeArtifactService{}, nil)
	svc.SetSkillService(skills)
	if b, o := svc.resolveArchitectSkills(context.Background(), "acme"); b != nil || o != nil {
		t.Fatalf("a skills lookup failure must degrade to no skills, got (%v,%v)", b, o)
	}
}

func TestExtractWireframeDsls(t *testing.T) {
	t.Parallel()
	got := extractWireframeDsls(map[string]string{
		"login.dsl":       "canvas-dsl-1",
		"requirements.md": "# not a dsl",
		"home.dsl":        "canvas-dsl-2",
	})
	if len(got) != 2 || got["login"] != "canvas-dsl-1" || got["home"] != "canvas-dsl-2" {
		t.Fatalf("only .dsl files, keyed by canvas name: %+v", got)
	}
}
