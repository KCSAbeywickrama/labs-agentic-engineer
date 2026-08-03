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

package gitfs_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/gitfs"
)

func TestNew_RootCreatedWhenMissing(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspaces")
	eng, layout, err := gitfs.New(root)
	if err != nil {
		t.Fatalf("gitfs.New: %v", err)
	}
	if layout != gitfs.RootCreated {
		t.Fatalf("layout = %q, want %q", layout, gitfs.RootCreated)
	}
	if eng.Root() == "" {
		t.Fatal("empty engine root")
	}
}

func TestNew_RootFoundWhenExists(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspaces")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	_, layout, err := gitfs.New(root)
	if err != nil {
		t.Fatalf("gitfs.New: %v", err)
	}
	if layout != gitfs.RootFound {
		t.Fatalf("layout = %q, want %q", layout, gitfs.RootFound)
	}
}

func TestNew_SecondCallFindsExisting(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspaces")
	if _, layout, err := gitfs.New(root); err != nil || layout != gitfs.RootCreated {
		t.Fatalf("first New: layout=%q err=%v", layout, err)
	}
	_, layout, err := gitfs.New(root)
	if err != nil {
		t.Fatalf("second New: %v", err)
	}
	if layout != gitfs.RootFound {
		t.Fatalf("second layout = %q, want %q", layout, gitfs.RootFound)
	}
}
