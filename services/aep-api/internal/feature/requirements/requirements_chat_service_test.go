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

// UNIT tier for the requirements-chat service: the REAL requirementsChatService
// with a faked artifact seam (real ArtifactStore decorator over
// FakeArtifactService) and a no-DB locker so the tx-lock wrapper runs the closure
// inline. Proves the non-streaming operations (UndoTurn, per-file baseline
// get/drop/revert, including the requirements.md-truncate carve-out), the
// tool-result apply/delete/DSL-render side-effects, and the pure scope/mode
// helpers. Per the SSE rule (§7) StreamChat's frame-forwarding shape is NOT
// asserted here — its side-effect logic is proven directly via applyToolResult.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
)

// newChatSvc wires the REAL requirementsChatService with the real store decorator
// over `fake`, the same fake as the direct artifactSvc, `ag` (nil when a test
// never streams / renders), and a no-DB locker (WithTxLock runs fn inline; real
// contention is dbtest-tier).
func newChatSvc(fake *artifactstest.FakeArtifactService, ag agents.Client) *requirementsChatService {
	return &requirementsChatService{
		store:        artifacts.NewArtifactStore(fake),
		agentsClient: ag,
		artifactSvc:  fake,
		locker:       NewRequirementsDirLocker(nil),
	}
}

// --- pure helpers -------------------------------------------------------------

func TestFilterScope(t *testing.T) {
	t.Parallel()
	all := map[string]string{"a.md": "1", "b.md": "2", "c.md": "3"}
	cases := []struct {
		name  string
		scope []string
		want  []string // expected keys
	}{
		{"empty scope means all", nil, []string{"a.md", "b.md", "c.md"}},
		{"subset", []string{"a.md", "c.md"}, []string{"a.md", "c.md"}},
		{"unknown names are skipped", []string{"a.md", "missing.md"}, []string{"a.md"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := filterScope(all, tc.scope)
			if len(got) != len(tc.want) {
				t.Fatalf("keys: got %v, want %v", got, tc.want)
			}
			for _, k := range tc.want {
				if _, ok := got[k]; !ok {
					t.Fatalf("missing key %q in %v", k, got)
				}
			}
		})
	}
}

func TestFallbackMode(t *testing.T) {
	t.Parallel()
	cases := map[string]string{"ask": "ask", "edit": "edit", "": "edit", "weird": "edit"}
	for in, want := range cases {
		if got := fallbackMode(in); got != want {
			t.Fatalf("fallbackMode(%q)=%q, want %q", in, got, want)
		}
	}
}

// --- UndoTurn -----------------------------------------------------------------

func TestUndoTurn(t *testing.T) {
	t.Parallel()

	t.Run("empty turnID is rejected", func(t *testing.T) {
		t.Parallel()
		if _, err := newChatSvc(&artifactstest.FakeArtifactService{}, nil).UndoTurn(context.Background(), "acme", "web", ""); err == nil {
			t.Fatal("empty turnId must be rejected")
		}
	})

	t.Run("restores then drops the snapshot", func(t *testing.T) {
		t.Parallel()
		dropped := false
		fake := &artifactstest.FakeArtifactService{
			RestoreRequirementsSnapshotFunc: func(_ context.Context, _, _, id string) (map[string]string, error) {
				return map[string]string{"requirements.md": "restored"}, nil
			},
			DeleteRequirementsSnapshotFunc: func(context.Context, string, string, string) error {
				dropped = true
				return nil
			},
		}
		files, err := newChatSvc(fake, nil).UndoTurn(context.Background(), "acme", "web", "t_1")
		if err != nil {
			t.Fatalf("undo: %v", err)
		}
		if files["requirements.md"] != "restored" || !dropped {
			t.Fatalf("undo result: files=%v dropped=%v", files, dropped)
		}
	})

	t.Run("restore error propagates", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			RestoreRequirementsSnapshotFunc: func(context.Context, string, string, string) (map[string]string, error) {
				return nil, errors.New("no such snapshot")
			},
		}
		if _, err := newChatSvc(fake, nil).UndoTurn(context.Background(), "acme", "web", "t_1"); err == nil {
			t.Fatal("a restore failure must propagate")
		}
	})

	t.Run("snapshot-drop failure is non-fatal", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			RestoreRequirementsSnapshotFunc: func(context.Context, string, string, string) (map[string]string, error) {
				return map[string]string{"requirements.md": "restored"}, nil
			},
			DeleteRequirementsSnapshotFunc: func(context.Context, string, string, string) error {
				return errors.New("blob delete failed")
			},
		}
		files, err := newChatSvc(fake, nil).UndoTurn(context.Background(), "acme", "web", "t_1")
		if err != nil {
			t.Fatalf("a snapshot-drop failure must be swallowed, got %v", err)
		}
		if files["requirements.md"] != "restored" {
			t.Fatalf("undo must still return restored files, got %v", files)
		}
	})
}

// --- session baseline: get / drop / revert -----------------------------------

func TestGetSessionBaselineFile(t *testing.T) {
	t.Parallel()

	t.Run("validation", func(t *testing.T) {
		t.Parallel()
		svc := newChatSvc(&artifactstest.FakeArtifactService{}, nil)
		if _, err := svc.GetSessionBaselineFile(context.Background(), "acme", "web", "", "f.md"); err == nil {
			t.Fatal("empty baselineID must be rejected")
		}
		if _, err := svc.GetSessionBaselineFile(context.Background(), "acme", "web", "sb_1", ""); err == nil {
			t.Fatal("empty filename must be rejected")
		}
	})

	t.Run("projects the snapshot file", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
				return "baseline-body", true, nil
			},
		}
		got, err := newChatSvc(fake, nil).GetSessionBaselineFile(context.Background(), "acme", "web", "sb_1", "functional.md")
		if err != nil {
			t.Fatalf("get baseline file: %v", err)
		}
		if got.SnapshotID != "sb_1" || got.Filename != "functional.md" || got.Content != "baseline-body" || !got.Existed {
			t.Fatalf("projection: %+v", got)
		}
	})

	t.Run("read error propagates", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
				return "", false, errors.New("boom")
			},
		}
		if _, err := newChatSvc(fake, nil).GetSessionBaselineFile(context.Background(), "acme", "web", "sb_1", "f.md"); err == nil {
			t.Fatal("a read failure must propagate")
		}
	})
}

func TestDropSessionBaseline(t *testing.T) {
	t.Parallel()

	t.Run("empty baselineID is rejected", func(t *testing.T) {
		t.Parallel()
		if err := newChatSvc(&artifactstest.FakeArtifactService{}, nil).DropSessionBaseline(context.Background(), "acme", "web", ""); err == nil {
			t.Fatal("empty baselineID must be rejected")
		}
	})

	t.Run("deletes the snapshot", func(t *testing.T) {
		t.Parallel()
		var droppedID string
		fake := &artifactstest.FakeArtifactService{
			DeleteRequirementsSnapshotFunc: func(_ context.Context, _, _, id string) error {
				droppedID = id
				return nil
			},
		}
		if err := newChatSvc(fake, nil).DropSessionBaseline(context.Background(), "acme", "web", "sb_9"); err != nil {
			t.Fatalf("drop: %v", err)
		}
		if droppedID != "sb_9" {
			t.Fatalf("dropped snapshot id: got %q", droppedID)
		}
	})
}

func TestRevertFileToBaseline(t *testing.T) {
	t.Parallel()

	t.Run("validation", func(t *testing.T) {
		t.Parallel()
		svc := newChatSvc(&artifactstest.FakeArtifactService{}, nil)
		if err := svc.RevertFileToBaseline(context.Background(), "acme", "web", "", "f.md"); err == nil {
			t.Fatal("empty baselineID must be rejected")
		}
		if err := svc.RevertFileToBaseline(context.Background(), "acme", "web", "sb_1", ""); err == nil {
			t.Fatal("empty filename must be rejected")
		}
	})

	t.Run("file existed at baseline → write-back", func(t *testing.T) {
		t.Parallel()
		var wroteContent string
		fake := &artifactstest.FakeArtifactService{
			ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
				return "original-body", true, nil
			},
			PutFileFunc: func(_ context.Context, _, _, _, content, _ string) (*artifacts.PutResult, error) {
				wroteContent = content
				return &artifacts.PutResult{SHA: "sha1"}, nil
			},
		}
		if err := newChatSvc(fake, nil).RevertFileToBaseline(context.Background(), "acme", "web", "sb_1", "functional.md"); err != nil {
			t.Fatalf("revert: %v", err)
		}
		if wroteContent != "original-body" {
			t.Fatalf("write-back content: got %q", wroteContent)
		}
	})

	t.Run("file absent at baseline → delete working-tree file", func(t *testing.T) {
		t.Parallel()
		deleted := ""
		fake := &artifactstest.FakeArtifactService{
			ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
				return "", false, nil
			},
			DeleteRequirementFileFunc: func(_ context.Context, _, _, name string) error {
				deleted = name
				return nil
			},
		}
		if err := newChatSvc(fake, nil).RevertFileToBaseline(context.Background(), "acme", "web", "sb_1", "functional.md"); err != nil {
			t.Fatalf("revert: %v", err)
		}
		if deleted != "functional.md" {
			t.Fatalf("deleted file: got %q", deleted)
		}
	})

	t.Run("protected main file absent at baseline → truncate, not delete", func(t *testing.T) {
		t.Parallel()
		var wrotePath, wroteContent string
		fake := &artifactstest.FakeArtifactService{
			ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
				return "", false, nil
			},
			// DeleteRequirementFile intentionally unset — reaching it (i.e.
			// trying to delete requirements.md) would panic the test.
			PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
				wrotePath, wroteContent = relPath, content
				return &artifacts.PutResult{SHA: "sha1"}, nil
			},
		}
		if err := newChatSvc(fake, nil).RevertFileToBaseline(context.Background(), "acme", "web", "sb_1", artifacts.RequirementsMainFile); err != nil {
			t.Fatalf("revert main: %v", err)
		}
		if !strings.HasSuffix(wrotePath, artifacts.RequirementsMainFile) || wroteContent != "" {
			t.Fatalf("main file must be truncated to empty, got path=%q content=%q", wrotePath, wroteContent)
		}
	})

	t.Run("already-gone delete is treated as success", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
				return "", false, nil
			},
			DeleteRequirementFileFunc: func(context.Context, string, string, string) error {
				return artifacts.ErrArtifactNotFound
			},
		}
		if err := newChatSvc(fake, nil).RevertFileToBaseline(context.Background(), "acme", "web", "sb_1", "functional.md"); err != nil {
			t.Fatalf("an already-deleted file must be a no-op success, got %v", err)
		}
	})

	t.Run("read-baseline error propagates", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ReadFileFromRequirementsSnapshotFunc: func(context.Context, string, string, string, string) (string, bool, error) {
				return "", false, errors.New("snapshot gone")
			},
		}
		if err := newChatSvc(fake, nil).RevertFileToBaseline(context.Background(), "acme", "web", "sb_1", "functional.md"); err == nil {
			t.Fatal("a baseline-read failure must propagate")
		}
	})
}

// --- applyToolResult (the persistence side-effect of a chat turn) ------------

func TestApplyToolResult_Validation(t *testing.T) {
	t.Parallel()
	svc := newChatSvc(&artifactstest.FakeArtifactService{}, nil)

	if err := svc.applyToolResult(context.Background(), "acme", "web", map[string]any{}); err == nil {
		t.Fatal("a frame with no data must error")
	}
	frameNoName := map[string]any{"data": map[string]any{"content": "x"}}
	if err := svc.applyToolResult(context.Background(), "acme", "web", frameNoName); err == nil {
		t.Fatal("a frame with no filename must error")
	}
}

func TestApplyToolResult_WritesFile(t *testing.T) {
	t.Parallel()
	var wrotePath, wroteContent string
	fake := &artifactstest.FakeArtifactService{
		// Primary path always reads the current file first; report absent so the
		// empty-content delete heuristic never triggers on a real write.
		GetFileFunc: func(context.Context, string, string, string) (*artifacts.FileResult, error) {
			return nil, artifacts.ErrArtifactNotFound
		},
		PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
			wrotePath, wroteContent = relPath, content
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
	}
	frame := map[string]any{"data": map[string]any{"filename": "functional.md", "content": "new-body"}}
	if err := newChatSvc(fake, nil).applyToolResult(context.Background(), "acme", "web", frame); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !strings.HasSuffix(wrotePath, "functional.md") || wroteContent != "new-body" {
		t.Fatalf("write: path=%q content=%q", wrotePath, wroteContent)
	}
}

func TestApplyToolResult_EmptyContentOnExistingMarkdownDeletes(t *testing.T) {
	t.Parallel()
	deleted := ""
	fake := &artifactstest.FakeArtifactService{
		// File exists (read succeeds) + empty content + .md → interpreted as delete.
		GetFileFunc: func(context.Context, string, string, string) (*artifacts.FileResult, error) {
			return &artifacts.FileResult{Content: "old"}, nil
		},
		DeleteRequirementFileFunc: func(_ context.Context, _, _, name string) error {
			deleted = name
			return nil
		},
	}
	frame := map[string]any{"data": map[string]any{"filename": "functional.md", "content": ""}}
	if err := newChatSvc(fake, nil).applyToolResult(context.Background(), "acme", "web", frame); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if deleted != "functional.md" {
		t.Fatalf("empty-content .md write on an existing file must delete it, deleted=%q", deleted)
	}
}

func TestApplyToolResult_DslWriteRendersExcalidrawSibling(t *testing.T) {
	t.Parallel()
	var renderKind, renderDsl string
	writes := map[string]string{}
	fake := &artifactstest.FakeArtifactService{
		GetFileFunc: func(context.Context, string, string, string) (*artifacts.FileResult, error) {
			return nil, artifacts.ErrArtifactNotFound
		},
		PutFileFunc: func(_ context.Context, _, _, relPath, content, _ string) (*artifacts.PutResult, error) {
			writes[relPath] = content
			return &artifacts.PutResult{SHA: "sha1"}, nil
		},
	}
	ag := &fakeAgents{
		RenderDslFunc: func(_ context.Context, kind, dsl string) (string, error) {
			renderKind, renderDsl = kind, dsl
			return `{"excalidraw":true}`, nil
		},
	}
	frame := map[string]any{"data": map[string]any{"filename": "wireframes.dsl", "content": "canvas-dsl"}}
	if err := newChatSvc(fake, ag).applyToolResult(context.Background(), "acme", "web", frame); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if renderKind != "wireframes" || renderDsl != "canvas-dsl" {
		t.Fatalf("RenderDsl args: kind=%q dsl=%q", renderKind, renderDsl)
	}
	// Both the DSL source and the rendered .excalidraw sibling are persisted.
	var wroteDSL, wroteSibling bool
	for p, c := range writes {
		if strings.HasSuffix(p, "wireframes.dsl") && c == "canvas-dsl" {
			wroteDSL = true
		}
		if strings.HasSuffix(p, "wireframes.excalidraw") && c == `{"excalidraw":true}` {
			wroteSibling = true
		}
	}
	if !wroteDSL || !wroteSibling {
		t.Fatalf("expected both dsl + excalidraw writes, got %v", writes)
	}
	// The frame is augmented in place so the browser refreshes its canvas buffer.
	data := frame["data"].(map[string]any)
	siblings, _ := data["siblings"].(map[string]any)
	if siblings["wireframes.excalidraw"] != `{"excalidraw":true}` {
		t.Fatalf("frame siblings not augmented: %v", data["siblings"])
	}
}
