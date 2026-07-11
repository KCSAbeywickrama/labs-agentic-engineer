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
// The read + version HTTP surface (get-design-bundle, get-design-bundle-at-tag,
// discard-design-changes, list-design-versions, and their backing GetDesign/
// GetDesignAtTag/GetDesignBundle/GetDesignBundleAtTag/DiscardChanges/
// ListDesignVersions/decodeDesignTag/AssembleDesignFromFiles helpers) was
// removed outright — superseded by the Files API (list-files/read-file). This
// file proves what remains: the ErrSpecNotApproved save gate, that the
// task-reconcile port is invoked on save (and a nil port never panics), and
// the versioning map SaveAndProceed's projection uses.
package design

import (
	"context"
	"errors"
	"testing"

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
// component with a design.json + openapi.yaml. Mirrors the harvested golden shape.
func validDesignFiles() map[string]string {
	return map[string]string{
		artifacts.DesignRootFile: "---\nsourceSpec: v1\n---\n\nOverview prose here.\n",
		"components/hello-api/design.json": "{\n" +
			"  \"name\": \"hello-api\",\n" +
			"  \"type\": \"service\",\n" +
			"  \"language\": \"Go\",\n" +
			"  \"description\": \"Build it.\",\n" +
			"  \"dependencies\": []\n" +
			"}\n",
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
