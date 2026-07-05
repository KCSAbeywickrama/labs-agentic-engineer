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
// runs for real) and the inline task-reconcile consumer port (taskReconciler).
// No HTTP, no DB — design has no SQL-shaped behavior (persistence delegates to
// artifacts/git), so there is no dbtest tier for this feature.
//
// Per the GitHub-direct rework (docs/design/agents-generation-migration.md
// §12.2) the per-file PUT/DELETE, component delete, and the architect generate
// stream are gone; what remains is the read + save + version surface. This file
// proves the service's surviving logic branches: the design assembly + status
// projection, the versioning map, the ErrSpecNotApproved save gate, and that
// the task-reconcile port is invoked on save (and a nil port never panics). The
// HTTP contract (status codes, error mapping, the gate 401) lives in
// design_component_test.go.
package design

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
)

// --- fakes -------------------------------------------------------------------

// portCall records the (org, project) args the task-reconcile port saw.
type portCall struct {
	org, project string
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
// wrapping it in the REAL ArtifactStore decorator.
func newService(fake *artifactstest.FakeArtifactService) *designService {
	return &designService{
		store:       artifacts.NewArtifactStore(fake),
		artifactSvc: fake,
	}
}

// --- GetDesign ---------------------------------------------------------------

func TestGetDesign_NoDesignYet(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil // empty tree → ReadDesign returns nil,nil
		},
	}
	d, err := newService(fake).GetDesign(context.Background(), "acme", "web")
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
	d, err := newService(fake).GetDesign(context.Background(), "acme", "web")
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
	d, err := newService(fake).GetDesign(context.Background(), "acme", "web")
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
	d, err := newService(fake).GetDesign(context.Background(), "acme", "web")
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
	d, err := newService(fake).GetDesign(context.Background(), "acme", "web")
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
	_, err := newService(fake).GetDesignAtTag(context.Background(), "acme", "web", "v1-1")
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
	d, err := newService(fake).GetDesignAtTag(context.Background(), "acme", "web", "v3-2")
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
	b, err := newService(fake).GetDesignBundle(context.Background(), "acme", "web")
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
	b, err := newService(fake).GetDesignBundleAtTag(context.Background(), "acme", "web", "v1-1")
	if err != nil {
		t.Fatalf("GetDesignBundleAtTag: %v", err)
	}
	if len(b.Files) == 0 || b.Design == nil {
		t.Fatalf("bundle-at-tag must carry files + design: %+v", b)
	}
}

// --- SaveAndProceed: the task-reconcile port ---------------------------------

func TestSaveAndProceed_NilClientErrors(t *testing.T) {
	t.Parallel()
	s := &designService{artifactSvc: nil}
	if _, err := s.SaveAndProceed(context.Background(), "acme", "web", ""); err == nil {
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
	_, err := newService(fake).SaveAndProceed(context.Background(), "acme", "web", "")
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
			return nil, artifacts.ErrNoRequirementsBaseline
		},
	}
	_, err := newService(fake).SaveAndProceed(context.Background(), "acme", "web", "")
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
	svc := newService(fake)
	svc.SetTaskService(task)

	d, err := svc.SaveAndProceed(context.Background(), "acme", "web", "")
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
	svc := newService(fake) // no SetTaskService
	if _, err := svc.SaveAndProceed(context.Background(), "acme", "web", ""); err != nil {
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
	svc := newService(fake)
	svc.SetTaskService(task)
	// The save succeeded; a reconcile failure is logged, never surfaced.
	if _, err := svc.SaveAndProceed(context.Background(), "acme", "web", ""); err != nil {
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
	_, err := newService(fake).DiscardChanges(context.Background(), "acme", "web")
	if !errors.Is(err, artifacts.ErrArtifactNotFound) {
		t.Fatalf("a discard with no saved version must surface the not-found error, got %v", err)
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
	d, err := newService(fake).DiscardChanges(context.Background(), "acme", "web")
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
	v, err := newService(fake).ListDesignVersions(context.Background(), "acme", "web")
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
