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

package reaper

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/config"
	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

func TestRootHealth_FailureFlipsReadiness(t *testing.T) {
	gate := &ReadyGate{}
	gate.Set(true)
	r, root := newSyntheticReaperReady(t, testCfg(), staticLister(nil), gate)
	if !gate.Ready() {
		t.Fatal("gate should start ready")
	}

	r.Sweep(context.Background())
	if !gate.Ready() {
		t.Fatal("healthy root should keep readiness true")
	}

	if err := os.RemoveAll(gitfs.ReposDir(root)); err != nil {
		t.Fatalf("remove repos/: %v", err)
	}
	r.Sweep(context.Background())
	if gate.Ready() {
		t.Fatal("missing repos/ must fail readiness")
	}

	if err := os.MkdirAll(gitfs.ReposDir(root), 0o755); err != nil {
		t.Fatalf("restore repos/: %v", err)
	}
	r.Sweep(context.Background())
	if !gate.Ready() {
		t.Fatal("restored layout must recover readiness")
	}
}

func TestRootHealth_NotWritableFlipsReadiness(t *testing.T) {
	gate := &ReadyGate{}
	gate.Set(true)
	r, root := newSyntheticReaperReady(t, testCfg(), staticLister(nil), gate)

	if err := os.Chmod(root, 0o555); err != nil {
		t.Fatalf("chmod root: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(root, 0o755) })

	r.Sweep(context.Background())
	if gate.Ready() {
		t.Fatal("unwritable root must fail readiness")
	}
}

func TestSweep_UsageLogFields(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	gate := &ReadyGate{}
	gate.Set(true)
	r, root := newSyntheticReaperReady(t, testCfg(), staticLister(nil), gate)
	mkFile(t, filepath.Join(gitfs.TrashDir(root), "old-trash", "payload"), 64)
	mkFile(t, filepath.Join(gitfs.TmpDir(root), "debris", "payload"), 32)

	r.Sweep(context.Background())

	var found map[string]any
	for _, line := range strings.Split(buf.String(), "\n") {
		if !strings.Contains(line, `"msg":"reaper: sweep usage"`) {
			continue
		}
		found = map[string]any{}
		if err := json.Unmarshal([]byte(line), &found); err != nil {
			t.Fatalf("parse usage log: %v\nline=%s", err, line)
		}
		break
	}
	if found == nil {
		t.Fatalf("no sweep usage log line; got:\n%s", buf.String())
	}
	for _, key := range []string{
		"usedBytes", "totalBytes", "usedInodes", "totalInodes",
		"trashBytes", "tmpBytes", "evictions", "reposMaintained", "leaderHeld",
	} {
		if _, ok := found[key]; !ok {
			t.Errorf("usage log missing %q; got %#v", key, found)
		}
	}
}

func newSyntheticReaperReady(t *testing.T, cfg config.WorkspaceConfig, repos RepoLister, ready *ReadyGate) (*Reaper, string) {
	t.Helper()
	eng, _, err := gitfs.New(filepath.Join(t.TempDir(), "workspaces"))
	if err != nil {
		t.Fatalf("gitfs.New: %v", err)
	}
	return New(eng, repos, cfg, ready), eng.Root()
}
