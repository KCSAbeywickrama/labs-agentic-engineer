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
// requirements.md-protection and file-map logic stay real while the git/agents
// I/O is faked. Proves the bundle-assembly branches (draft/approved/
// has-unsaved-changes), the mutating ops' git-client-not-configured guards and
// sentinel translation, the versioning mapping, withLock delegation, and — per
// the SSE rule (§7) — StreamGenerate's COMPLETION + persisted side-effect only,
// never stream framing. The HTTP contract lives in requirements_component_test.go;
// the advisory locker lives in requirements_dbtest_test.go.

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
)

// --- agents.Client hand fake --------------------------------------------------
// agents.Client is a narrow, in-process port (an interface), so it is hand-faked
// here rather than mocked at the wire (bff-component-testing.md §6 — the
// out-of-process boundary is agents-service's HTTP surface, which the client
// owns; the service under test only sees this interface). Unset funcs panic,
// moq-style, so a test that reaches an unexpected method fails loudly.
type fakeAgents struct {
	StreamDocumentGenerationFunc func(ctx context.Context, orgID, skillID string, req agents.DocumentGenerationRequest) (io.ReadCloser, error)
	StreamRequirementsChatFunc   func(ctx context.Context, orgID string, req agents.RequirementsChatRequest) (io.ReadCloser, error)
	RenderDslFunc                func(ctx context.Context, kind, dsl string) (string, error)
}

var _ agents.Client = (*fakeAgents)(nil)

func (f *fakeAgents) StreamDocumentGeneration(ctx context.Context, orgID, skillID string, req agents.DocumentGenerationRequest) (io.ReadCloser, error) {
	if f.StreamDocumentGenerationFunc == nil {
		panic("fakeAgents: StreamDocumentGeneration not set")
	}
	return f.StreamDocumentGenerationFunc(ctx, orgID, skillID, req)
}
func (f *fakeAgents) StreamRequirementsChat(ctx context.Context, orgID string, req agents.RequirementsChatRequest) (io.ReadCloser, error) {
	if f.StreamRequirementsChatFunc == nil {
		panic("fakeAgents: StreamRequirementsChat not set")
	}
	return f.StreamRequirementsChatFunc(ctx, orgID, req)
}
func (f *fakeAgents) RenderDsl(ctx context.Context, kind, dsl string) (string, error) {
	if f.RenderDslFunc == nil {
		panic("fakeAgents: RenderDsl not set")
	}
	return f.RenderDslFunc(ctx, kind, dsl)
}
func (f *fakeAgents) StreamArchitect(context.Context, string, agents.ArchitectRequest) (io.ReadCloser, error) {
	panic("fakeAgents: StreamArchitect not expected in requirements tests")
}
func (f *fakeAgents) StreamTechLeadPlan(context.Context, string, agents.TechLeadPlanRequest) (io.ReadCloser, error) {
	panic("fakeAgents: StreamTechLeadPlan not expected in requirements tests")
}
func (f *fakeAgents) StreamTechLeadDetail(context.Context, string, agents.TechLeadDetailRequest) (io.ReadCloser, error) {
	panic("fakeAgents: StreamTechLeadDetail not expected in requirements tests")
}

// newReqSvc wires the REAL requirementsService: the real ArtifactStore decorator
// over `fake` (so store logic runs), the same fake as the direct artifactSvc
// seam, and `ag` (nil when a test never streams). No locker → withLock runs the
// closure inline (the lock's real behavior is dbtest-tier).
func newReqSvc(fake *artifactstest.FakeArtifactService, ag agents.Client) *requirementsService {
	return NewRequirementsService(artifacts.NewArtifactStore(fake), ag, fake)
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
	b, err := newReqSvc(fake, nil).GetRequirements(context.Background(), "acme", "web")
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
	b, err := newReqSvc(fake, nil).GetRequirements(context.Background(), "acme", "web")
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
	b, err := newReqSvc(fake, nil).GetRequirements(context.Background(), "acme", "web")
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
	b, err := newReqSvc(fake, nil).GetRequirements(context.Background(), "acme", "web")
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
	if _, err := newReqSvc(fake, nil).GetRequirements(context.Background(), "acme", "web"); err == nil {
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
	svc := NewRequirementsService(artifacts.NewArtifactStore(fake), nil, nil)
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
		b, err := newReqSvc(fake, nil).GetRequirementsAtTag(context.Background(), "acme", "web", "v1")
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
		_, err := newReqSvc(fake, nil).GetRequirementsAtTag(context.Background(), "acme", "web", "v9")
		if !errors.Is(err, artifacts.ErrSpecNotFound) {
			t.Fatalf("want ErrSpecNotFound, got %v", err)
		}
	})

	t.Run("nil artifactSvc is git-client-not-configured", func(t *testing.T) {
		t.Parallel()
		svc := NewRequirementsService(nil, nil, nil)
		if _, err := svc.GetRequirementsAtTag(context.Background(), "acme", "web", "v1"); err == nil {
			t.Fatal("want an error when the git client is not configured")
		}
	})
}

// --- UpdateRequirementFile / DeleteRequirementFile ---------------------------

func TestUpdateRequirementFile_WritesThenReturnsBundle(t *testing.T) {
	t.Parallel()
	var wroteName, wroteContent string
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
			wroteName, wroteContent = relPath, content
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"functional.md": "body"}, nil
		},
		// GetRequirements re-runs after the write; with files present it consults
		// the versions seam — return none so the refresh stays at draft.
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return nil, nil
		},
	}
	b, err := newReqSvc(fake, nil).UpdateRequirementFile(context.Background(), "acme", "web", "functional.md", "body")
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !strings.HasSuffix(wroteName, "functional.md") || wroteContent != "body" {
		t.Fatalf("PutFile args: path=%q content=%q", wroteName, wroteContent)
	}
	if b == nil || len(b.Files) != 1 {
		t.Fatalf("post-write bundle: %+v", b)
	}
}

func TestUpdateRequirementFile_WriteErrorPropagates(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
			return nil, errors.New("disk full")
		},
	}
	if _, err := newReqSvc(fake, nil).UpdateRequirementFile(context.Background(), "acme", "web", "functional.md", "x"); err == nil {
		t.Fatal("a write failure must propagate")
	}
}

func TestDeleteRequirementFile_HappyPath(t *testing.T) {
	t.Parallel()
	deleted := ""
	fake := &artifactstest.FakeArtifactService{
		DeleteRequirementFileFunc: func(_ context.Context, _, _, name string) error {
			deleted = name
			return nil
		},
		ListRequirementFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return map[string]string{"requirements.md": "# R\n"}, nil
		},
		ListRequirementsVersionsFunc: func(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
			return nil, nil
		},
	}
	if _, err := newReqSvc(fake, nil).DeleteRequirementFile(context.Background(), "acme", "web", "functional.md"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if deleted != "functional.md" {
		t.Fatalf("deleted file: got %q", deleted)
	}
}

func TestDeleteRequirementFile_MainFileIsProtected(t *testing.T) {
	t.Parallel()
	// The store refuses to delete requirements.md; the underlying artifactSvc
	// delete must never be reached (its unset func would panic if it were).
	fake := &artifactstest.FakeArtifactService{}
	_, err := newReqSvc(fake, nil).DeleteRequirementFile(context.Background(), "acme", "web", artifacts.RequirementsMainFile)
	if err == nil {
		t.Fatalf("deleting %s must be rejected", artifacts.RequirementsMainFile)
	}
	if !strings.Contains(err.Error(), artifacts.RequirementsMainFile) {
		t.Fatalf("error should name the protected file, got %v", err)
	}
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
		b, err := newReqSvc(fake, nil).SaveAndProceed(context.Background(), "acme", "web")
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
		if _, err := newReqSvc(fake, nil).SaveAndProceed(context.Background(), "acme", "web"); err == nil {
			t.Fatal("a save failure must propagate")
		}
	})

	t.Run("nil artifactSvc is git-client-not-configured", func(t *testing.T) {
		t.Parallel()
		if _, err := NewRequirementsService(nil, nil, nil).SaveAndProceed(context.Background(), "acme", "web"); err == nil {
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
		if _, err := newReqSvc(fake, nil).DiscardChanges(context.Background(), "acme", "web"); err != nil {
			t.Fatalf("discard: %v", err)
		}
		if !discarded {
			t.Fatal("DiscardRequirements was not invoked")
		}
	})

	t.Run("nothing-to-revert sentinel becomes a friendly error", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			DiscardRequirementsFunc: func(context.Context, string, string) (map[string]string, error) {
				return nil, artifacts.ErrArtifactNotFound
			},
		}
		_, err := newReqSvc(fake, nil).DiscardChanges(context.Background(), "acme", "web")
		if err == nil || !strings.Contains(err.Error(), "no saved version") {
			t.Fatalf("want a 'no saved version' error, got %v", err)
		}
	})

	t.Run("nil artifactSvc is git-client-not-configured", func(t *testing.T) {
		t.Parallel()
		if _, err := NewRequirementsService(nil, nil, nil).DiscardChanges(context.Background(), "acme", "web"); err == nil {
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
		vs, err := newReqSvc(fake, nil).ListVersions(context.Background(), "acme", "web")
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(vs) != 2 || vs[0].Version != 2 || vs[0].TagName != "v2" || vs[0].CommitHash != "h2" {
			t.Fatalf("mapping: got %+v", vs)
		}
	})

	t.Run("nil artifactSvc returns nil, nil", func(t *testing.T) {
		t.Parallel()
		vs, err := NewRequirementsService(nil, nil, nil).ListVersions(context.Background(), "acme", "web")
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
		if _, err := newReqSvc(fake, nil).ListVersions(context.Background(), "acme", "web"); err == nil {
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

// --- withLock delegation ------------------------------------------------------

func TestWithLock_NilLockerRunsInline(t *testing.T) {
	t.Parallel()
	svc := NewRequirementsService(nil, nil, nil) // no locker
	ran := false
	err := svc.withLock(context.Background(), "acme", "web", func(context.Context) error {
		ran = true
		return nil
	})
	if err != nil || !ran {
		t.Fatalf("nil locker must run fn inline: ran=%v err=%v", ran, err)
	}
}

func TestWithLocker_ChainsAndDelegates(t *testing.T) {
	t.Parallel()
	svc := NewRequirementsService(nil, nil, nil)
	// WithLocker returns the receiver for chaining and mutates it. A locker with
	// no DB degrades to running fn without a real lock (the lock's contention
	// semantics are dbtest-tier); this proves the delegation seam is wired.
	if got := svc.WithLocker(NewRequirementsDirLocker(nil)); got != svc {
		t.Fatal("WithLocker must return the receiver for chaining")
	}
	ran := false
	err := svc.withLock(context.Background(), "acme", "web", func(context.Context) error {
		ran = true
		return nil
	})
	if err != nil || !ran {
		t.Fatalf("no-DB locker must still run fn: ran=%v err=%v", ran, err)
	}
}

// --- StreamGenerate (SSE rule: completion + persisted side-effect only) -------

// sseStream builds an io.ReadCloser over the given SSE lines, as agents-service
// would return. Each line is emitted verbatim followed by a newline.
func sseStream(lines ...string) io.ReadCloser {
	return io.NopCloser(strings.NewReader(strings.Join(lines, "\n") + "\n"))
}

func TestStreamGenerate_PreStreamValidation(t *testing.T) {
	t.Parallel()
	svc := newReqSvc(&artifactstest.FakeArtifactService{}, &fakeAgents{})
	var out bytes.Buffer
	noflush := func() {}

	if err := svc.StreamGenerate(context.Background(), "acme", "web", "functional.md", "", nil, "", &out, noflush); err == nil {
		t.Fatal("empty skillID must be rejected before streaming")
	}
	if err := svc.StreamGenerate(context.Background(), "acme", "web", "", "skill-x", nil, "", &out, noflush); err == nil {
		t.Fatal("empty target filename must be rejected before streaming")
	}
}

func TestStreamGenerate_HappyPathPersistsAccumulatedContent(t *testing.T) {
	t.Parallel()
	var wrotePath, wroteContent string
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
			wrotePath, wroteContent = relPath, content
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
	}
	ag := &fakeAgents{
		StreamDocumentGenerationFunc: func(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
			return sseStream(
				`data: {"type":"text-delta","delta":"Hello "}`,
				`data: {"type":"text-delta","delta":"World"}`,
				`data: {"type":"finish"}`,
				`data: [DONE]`,
			), nil
		},
	}
	var out bytes.Buffer
	err := newReqSvc(fake, ag).StreamGenerate(context.Background(), "acme", "web", "functional.md", "skill-x", nil, "prompt", &out, func() {})
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	// SSE rule: assert the persisted side-effect (accumulated content written to
	// the target file), not the framing forwarded to `out`.
	if !strings.HasSuffix(wrotePath, "functional.md") || wroteContent != "Hello World" {
		t.Fatalf("persisted file: path=%q content=%q", wrotePath, wroteContent)
	}
}

func TestStreamGenerate_ReplaceResetsAccumulator(t *testing.T) {
	t.Parallel()
	// A text-delta with replace:true discards everything accumulated so far and
	// persists only the replacement payload (wireframes/domain-model post-process).
	var wroteContent string
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(_ context.Context, _, _, _, content, _ string) (*artifacts.PutResult, error) {
			wroteContent = content
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
	}
	ag := &fakeAgents{
		StreamDocumentGenerationFunc: func(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
			return sseStream(
				`data: {"type":"text-delta","delta":"draft-to-discard"}`,
				`data: {"type":"text-delta","delta":"FINAL","replace":true}`,
				`data: {"type":"finish"}`,
			), nil
		},
	}
	var out bytes.Buffer
	if err := newReqSvc(fake, ag).StreamGenerate(context.Background(), "acme", "web", "wireframes.dsl", "skill-x", nil, "", &out, func() {}); err != nil {
		t.Fatalf("stream: %v", err)
	}
	if wroteContent != "FINAL" {
		t.Fatalf("replace must reset the accumulator, persisted %q", wroteContent)
	}
}

func TestStreamGenerate_ErrorFrameSurfacedNoWrite(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		// PutFile intentionally unset — any write attempt panics the test.
	}
	ag := &fakeAgents{
		StreamDocumentGenerationFunc: func(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
			return sseStream(
				`data: {"type":"text-delta","delta":"partial"}`,
				`data: {"type":"error","errorText":"model refused"}`,
			), nil
		},
	}
	var out bytes.Buffer
	err := newReqSvc(fake, ag).StreamGenerate(context.Background(), "acme", "web", "functional.md", "skill-x", nil, "", &out, func() {})
	if err == nil || !strings.Contains(err.Error(), "model refused") {
		t.Fatalf("want the upstream error surfaced, got %v", err)
	}
}

func TestStreamGenerate_NoFinishIsAnError(t *testing.T) {
	t.Parallel()
	ag := &fakeAgents{
		StreamDocumentGenerationFunc: func(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
			return sseStream(`data: {"type":"text-delta","delta":"unterminated"}`), nil
		},
	}
	var out bytes.Buffer
	err := newReqSvc(&artifactstest.FakeArtifactService{}, ag).StreamGenerate(context.Background(), "acme", "web", "functional.md", "skill-x", nil, "", &out, func() {})
	if err == nil || !strings.Contains(err.Error(), "without finishing") {
		t.Fatalf("want a no-finish error, got %v", err)
	}
}

func TestStreamGenerate_EmptyContentIsAnError(t *testing.T) {
	t.Parallel()
	ag := &fakeAgents{
		StreamDocumentGenerationFunc: func(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
			return sseStream(`data: {"type":"finish"}`), nil
		},
	}
	var out bytes.Buffer
	err := newReqSvc(&artifactstest.FakeArtifactService{}, ag).StreamGenerate(context.Background(), "acme", "web", "functional.md", "skill-x", nil, "", &out, func() {})
	if err == nil || !strings.Contains(err.Error(), "no content") {
		t.Fatalf("want a no-content error, got %v", err)
	}
}

func TestStreamGenerate_UpstreamOpenErrorPropagates(t *testing.T) {
	t.Parallel()
	ag := &fakeAgents{
		StreamDocumentGenerationFunc: func(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
			return nil, errors.New("agents-service 503")
		},
	}
	var out bytes.Buffer
	err := newReqSvc(&artifactstest.FakeArtifactService{}, ag).StreamGenerate(context.Background(), "acme", "web", "functional.md", "skill-x", nil, "", &out, func() {})
	if err == nil || !strings.Contains(err.Error(), "agents service request") {
		t.Fatalf("want the upstream open error wrapped, got %v", err)
	}
}

// TestStreamGenerate_SiblingFilesPersisted covers the finish-frame sibling
// loop (review gap): companion files (e.g. .excalidraw sources) are written
// alongside the primary file, a sibling whose name equals the primary is
// skipped (the accumulated stream content wins, never the sibling payload),
// and a failing sibling write is warn-and-continue — it must not fail the
// generation.
func TestStreamGenerate_SiblingFilesPersisted(t *testing.T) {
	t.Parallel()
	type write struct{ path, content string }
	var writes []write
	fake := &artifactstest.FakeArtifactService{
		PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
			writes = append(writes, write{relPath, content})
			if strings.HasSuffix(relPath, "broken.dsl") {
				return nil, errors.New("git wedged")
			}
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
	}
	ag := &fakeAgents{
		StreamDocumentGenerationFunc: func(context.Context, string, string, agents.DocumentGenerationRequest) (io.ReadCloser, error) {
			return sseStream(
				`data: {"type":"text-delta","delta":"PRIMARY"}`,
				`data: {"type":"finish","siblings":{"functional.md":"SELF-MUST-BE-SKIPPED","wireframes.excalidraw":"{\"kind\":\"excalidraw\"}","broken.dsl":"payload"}}`,
			), nil
		},
	}
	var out bytes.Buffer
	err := newReqSvc(fake, ag).StreamGenerate(context.Background(), "acme", "web", "functional.md", "skill-x", nil, "", &out, func() {})
	if err != nil {
		t.Fatalf("a failing sibling write must be best-effort, got %v", err)
	}

	var primary, selfDup int
	var gotSibling bool
	for _, w := range writes {
		switch {
		case strings.HasSuffix(w.path, "functional.md") && w.content == "PRIMARY":
			primary++
		case strings.HasSuffix(w.path, "functional.md"):
			selfDup++
		case strings.HasSuffix(w.path, "wireframes.excalidraw"):
			gotSibling = w.content == `{"kind":"excalidraw"}`
		}
	}
	if primary != 1 || selfDup != 0 {
		t.Fatalf("primary write: got %d primary + %d self-sibling overwrites, want exactly 1 + 0 (writes=%v)", primary, selfDup, writes)
	}
	if !gotSibling {
		t.Fatalf("sibling file was not persisted with its payload: %v", writes)
	}
}
