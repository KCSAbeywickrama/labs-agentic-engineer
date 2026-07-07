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

package requirements

// UNIT tier (bff-component-testing.md §2): the REAL requirementsService with its
// ports faked — no HTTP, no DB. The store seam is the REAL artifacts.ArtifactStore
// decorator wrapping a FakeArtifactService (Pilot A pattern), so the store's
// file-map logic stays real while the git I/O is faked. Per the GitHub-direct
// rework (docs/design/agents-generation-migration.md §5) this service is now the
// read + version surface only: it proves the bundle-assembly branches
// (draft/approved/has-unsaved-changes), the mutating ops' git-client-not-configured
// guards and sentinel translation, and the versioning mapping. The HTTP contract
// lives in requirements_component_test.go.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
)

// newReqSvc wires the REAL requirementsService: the real ArtifactStore decorator
// over `fake` (so store logic runs) is also the direct artifactSvc seam.
func newReqSvc(fake *artifactstest.FakeArtifactService) *requirementsService {
	return NewRequirementsService(artifacts.NewArtifactStore(fake), fake)
}

// --- GetRequirements ---------------------------------------------------------

func TestGetRequirements_EmptyDirIsDraftWithNoVersions(t *testing.T) {
	t.Parallel()
	// Empty working tree returns early — the versions seam must NOT be consulted
	// (unset ListRequirementsVersionsFunc would panic if it were).
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{}, nil
		},
	}
	b, err := newReqSvc(fake).GetRequirements(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if b.Status != "draft" || len(b.Files) != 0 || b.Version != 0 || len(b.Versions) != 0 || b.HasUnsavedChanges {
		t.Fatalf("empty dir: want draft/no-files/no-versions, got %+v", b)
	}
}

func TestGetRequirements_ApprovedWithVersions(t *testing.T) {
	t.Parallel()
	files := map[string]string{"requirements.md": "# R\n"}
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Version: 1, Tag: "v1", CommitHash: "abc"}}, nil
		},
		// Working tree equals the latest tagged snapshot → no unsaved changes.
		GetRequirementsAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R\n"}, nil
		},
	}
	b, err := newReqSvc(fake).GetRequirements(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if b.Status != "approved" || b.Version != 1 || len(b.Versions) != 1 || b.Versions[0].TagName != "v1" {
		t.Fatalf("approved: got %+v", b)
	}
	if b.HasUnsavedChanges {
		t.Fatal("working tree equals latest tag → HasUnsavedChanges must be false")
	}
}

func TestGetRequirements_HasUnsavedChangesWhenWorkingTreeDiffersFromTag(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# edited\n"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return []artifacts.RequirementsVersionInfo{{Version: 1, Tag: "v1"}}, nil
		},
		GetRequirementsAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# original\n"}, nil
		},
	}
	b, err := newReqSvc(fake).GetRequirements(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !b.HasUnsavedChanges {
		t.Fatal("working tree differs from latest tag → HasUnsavedChanges must be true")
	}
}

func TestGetRequirements_VersionListErrorDegradesToDraft(t *testing.T) {
	t.Parallel()
	// A versions-list failure is non-fatal (logged): the bundle still returns
	// with the working-tree files, status left at draft.
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R\n"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return nil, errors.New("git wedged")
		},
	}
	b, err := newReqSvc(fake).GetRequirements(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("versions error must be swallowed, got %v", err)
	}
	if b.Status != "draft" || len(b.Files) != 1 {
		t.Fatalf("degraded bundle: got %+v", b)
	}
}

func TestGetRequirements_ListErrorPropagates(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return nil, errors.New("boom")
		},
	}
	if _, err := newReqSvc(fake).GetRequirements(context.Background(), "acme", "web"); err == nil {
		t.Fatal("a working-tree list failure must propagate")
	}
}

func TestGetRequirements_NilArtifactSvcSkipsVersioning(t *testing.T) {
	t.Parallel()
	// With no artifactSvc, versions can't be resolved — the bundle is the raw
	// working tree at draft. store still needs the ListRequirementFiles seam, so
	// wrap a fake for the store but pass nil as the direct artifactSvc.
	fake := &artifactstest.FakeArtifactService{
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R\n"}, nil
		},
	}
	svc := NewRequirementsService(artifacts.NewArtifactStore(fake), nil)
	b, err := svc.GetRequirements(context.Background(), "acme", "web")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if b.Status != "draft" || len(b.Versions) != 0 {
		t.Fatalf("nil artifactSvc: want draft/no-versions, got %+v", b)
	}
}

// --- GetRequirementsAtTag -----------------------------------------------------

func TestGetRequirementsAtTag(t *testing.T) {
	t.Parallel()

	t.Run("happy", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			GetRequirementsAtTagFunc: func(_ context.Context, _, _, tag string) (map[string]string, error) {
				if tag != "v1" {
					t.Fatalf("tag: got %q", tag)
				}
				return map[string]string{"requirements.md": "# R\n"}, nil
			},
		}
		b, err := newReqSvc(fake).GetRequirementsAtTag(context.Background(), "acme", "web", "v1")
		if err != nil {
			t.Fatalf("get-at-tag: %v", err)
		}
		if b.Status != "approved" || len(b.Files) != 1 {
			t.Fatalf("bundle: got %+v", b)
		}
	})

	t.Run("not-found sentinel translated to ErrSpecNotFound", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			GetRequirementsAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
				return nil, artifacts.ErrArtifactNotFound
			},
		}
		_, err := newReqSvc(fake).GetRequirementsAtTag(context.Background(), "acme", "web", "v9")
		if !errors.Is(err, artifacts.ErrSpecNotFound) {
			t.Fatalf("want ErrSpecNotFound, got %v", err)
		}
	})

	t.Run("nil artifactSvc is git-client-not-configured", func(t *testing.T) {
		t.Parallel()
		svc := NewRequirementsService(nil, nil)
		if _, err := svc.GetRequirementsAtTag(context.Background(), "acme", "web", "v1"); err == nil {
			t.Fatal("want an error when the git client is not configured")
		}
	})
}

// --- SaveAndProceed / DiscardChanges -----------------------------------------

func TestSaveAndProceed(t *testing.T) {
	t.Parallel()

	t.Run("happy path returns refreshed bundle", func(t *testing.T) {
		t.Parallel()
		saved := false
		fake := &artifactstest.FakeArtifactService{
			SaveRequirementsFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.RequirementsSaveResult, error) {
				saved = true
				return &artifacts.RequirementsSaveResult{Status: "approved", Tag: "v2", Version: 2}, nil
			},
			ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
				return map[string]string{"requirements.md": "# R\n"}, nil
			},
			ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
				return []artifacts.RequirementsVersionInfo{{Version: 2, Tag: "v2"}}, nil
			},
			GetRequirementsAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
				return map[string]string{"requirements.md": "# R\n"}, nil
			},
		}
		b, err := newReqSvc(fake).SaveAndProceed(context.Background(), "acme", "web", "")
		if err != nil {
			t.Fatalf("save: %v", err)
		}
		if !saved || b.Version != 2 || b.Status != "approved" {
			t.Fatalf("save result: saved=%v bundle=%+v", saved, b)
		}
	})

	t.Run("save error propagates", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			SaveRequirementsFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.RequirementsSaveResult, error) {
				return nil, errors.New("git push rejected")
			},
		}
		if _, err := newReqSvc(fake).SaveAndProceed(context.Background(), "acme", "web", ""); err == nil {
			t.Fatal("a save failure must propagate")
		}
	})

	t.Run("nil artifactSvc is git-client-not-configured", func(t *testing.T) {
		t.Parallel()
		if _, err := NewRequirementsService(nil, nil).SaveAndProceed(context.Background(), "acme", "web", ""); err == nil {
			t.Fatal("want an error when the git client is not configured")
		}
	})
}

func TestDiscardChanges(t *testing.T) {
	t.Parallel()

	t.Run("happy path returns refreshed bundle", func(t *testing.T) {
		t.Parallel()
		discarded := false
		fake := &artifactstest.FakeArtifactService{
			DiscardRequirementsFunc: func(context.Context, string, string) (map[string]string, error) {
				discarded = true
				return map[string]string{"requirements.md": "# R\n"}, nil
			},
			ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
				return map[string]string{"requirements.md": "# R\n"}, nil
			},
			ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
				return nil, nil
			},
		}
		if _, err := newReqSvc(fake).DiscardChanges(context.Background(), "acme", "web"); err != nil {
			t.Fatalf("discard: %v", err)
		}
		if !discarded {
			t.Fatal("DiscardRequirements was not invoked")
		}
	})

	t.Run("discard error propagates wrapped", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			DiscardRequirementsFunc: func(context.Context, string, string) (map[string]string, error) {
				return nil, artifacts.ErrArtifactNotFound
			},
		}
		_, err := newReqSvc(fake).DiscardChanges(context.Background(), "acme", "web")
		if err == nil || !strings.Contains(err.Error(), "discard requirements") {
			t.Fatalf("want the discard error propagated, got %v", err)
		}
	})

	t.Run("nil artifactSvc is git-client-not-configured", func(t *testing.T) {
		t.Parallel()
		if _, err := NewRequirementsService(nil, nil).DiscardChanges(context.Background(), "acme", "web"); err == nil {
			t.Fatal("want an error when the git client is not configured")
		}
	})
}

// --- ListVersions + mapRequirementsVersions ----------------------------------

func TestListVersions(t *testing.T) {
	t.Parallel()

	t.Run("maps artifact versions to the flat wire shape", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
				return []artifacts.RequirementsVersionInfo{
					{Version: 2, Tag: "v2", CommitHash: "h2"},
					{Version: 1, Tag: "v1", CommitHash: "h1"},
				}, nil
			},
		}
		vs, err := newReqSvc(fake).ListVersions(context.Background(), "acme", "web")
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(vs) != 2 || vs[0].Version != 2 || vs[0].TagName != "v2" || vs[0].CommitHash != "h2" {
			t.Fatalf("mapping: got %+v", vs)
		}
	})

	t.Run("nil artifactSvc returns nil, nil", func(t *testing.T) {
		t.Parallel()
		vs, err := NewRequirementsService(nil, nil).ListVersions(context.Background(), "acme", "web")
		if err != nil || vs != nil {
			t.Fatalf("nil artifactSvc: want (nil,nil), got (%v,%v)", vs, err)
		}
	})

	t.Run("list error propagates", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
				return nil, errors.New("boom")
			},
		}
		if _, err := newReqSvc(fake).ListVersions(context.Background(), "acme", "web"); err == nil {
			t.Fatal("a list failure must propagate")
		}
	})
}

func TestMapRequirementsVersions_EmptyIsNil(t *testing.T) {
	t.Parallel()
	if got := mapRequirementsVersions(nil); got != nil {
		t.Fatalf("empty input must map to nil, got %+v", got)
	}
}

// --- fileMapsEqual (has-unsaved-changes primitive) ---------------------------

func TestFileMapsEqual(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		a, b map[string]string
		want bool
	}{
		{"identical", map[string]string{"a": "x"}, map[string]string{"a": "x"}, true},
		{"whitespace-insensitive", map[string]string{"a": "x\n"}, map[string]string{"a": "  x  "}, true},
		{"different length", map[string]string{"a": "x"}, map[string]string{"a": "x", "b": "y"}, false},
		{"different content", map[string]string{"a": "x"}, map[string]string{"a": "y"}, false},
		{"missing key", map[string]string{"a": "x"}, map[string]string{"b": "x"}, false},
		{"both empty", map[string]string{}, map[string]string{}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := fileMapsEqual(tc.a, tc.b); got != tc.want {
				t.Fatalf("fileMapsEqual(%v,%v)=%v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}
