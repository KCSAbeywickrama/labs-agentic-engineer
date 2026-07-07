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

package agentfold

import (
	"errors"
	"strings"
	"testing"
)

// verifyFold builds a fold with one applied write and one applied delete.
func verifyFold(t *testing.T) (*Fold, Manifest) {
	t.Helper()
	seed := map[string]string{"specs/old.md": "old\n"}
	f := NewFromSnapshot(seed)
	if res, err := f.AddFile(ctx, "specs/a.md", "alpha\n"); err != nil || !res.OK {
		t.Fatalf("seed add: %+v %v", res, err)
	}
	if res, err := f.RemoveFile(ctx, "specs/old.md"); err != nil || !res.OK {
		t.Fatalf("seed remove: %+v %v", res, err)
	}
	m := Manifest{
		Files:   map[string]string{"specs/a.md": sha256Hex("alpha\n")},
		Deleted: []string{"specs/old.md"},
	}
	return f, m
}

func TestVerify_MatchAndEmptyValid(t *testing.T) {
	f, m := verifyFold(t)
	if err := Verify(f, m); err != nil {
		t.Fatalf("clean verify: %v", err)
	}
	// Empty manifest against an untouched fold: the valid chat turn.
	empty := NewFromSnapshot(nil)
	if err := Verify(empty, Manifest{Files: map[string]string{}}); err != nil {
		t.Fatalf("empty verify: %v", err)
	}
	// Empty manifest against a fold that DID touch → both categories fire.
	var perr *FoldParityError
	if err := Verify(f, Manifest{}); !errors.As(err, &perr) ||
		len(perr.ExtraInFold) != 1 || len(perr.DeletedMismatch) != 1 {
		t.Fatalf("empty-vs-touched: %v", err)
	}
}

func TestVerify_SingleByteCorruptionNamesThePath(t *testing.T) {
	f, m := verifyFold(t)
	// One flipped hex nibble in the manifest hash — fold-parity must fail
	// naming exactly the corrupted path.
	h := m.Files["specs/a.md"]
	corrupt := "0"
	if h[0] == '0' {
		corrupt = "1"
	}
	m.Files["specs/a.md"] = corrupt + h[1:]
	var perr *FoldParityError
	err := Verify(f, m)
	if !errors.As(err, &perr) {
		t.Fatalf("want FoldParityError, got %v", err)
	}
	if len(perr.HashMismatch) != 1 || perr.HashMismatch[0] != "specs/a.md" {
		t.Fatalf("hash mismatch paths: %+v", perr)
	}
	if !strings.Contains(err.Error(), "specs/a.md") {
		t.Fatalf("error must carry the offending path: %v", err)
	}
}

func TestVerify_MissingExtraAndDeletedMismatch(t *testing.T) {
	f, m := verifyFold(t)

	t.Run("manifest lists an untouched path", func(t *testing.T) {
		m2 := Manifest{Files: map[string]string{
			"specs/a.md":       m.Files["specs/a.md"],
			"specs/phantom.md": sha256Hex("x"),
		}, Deleted: m.Deleted}
		var perr *FoldParityError
		if err := Verify(f, m2); !errors.As(err, &perr) ||
			len(perr.MissingInFold) != 1 || perr.MissingInFold[0] != "specs/phantom.md" {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("manifest omits a touched path", func(t *testing.T) {
		m2 := Manifest{Files: map[string]string{}, Deleted: m.Deleted}
		var perr *FoldParityError
		if err := Verify(f, m2); !errors.As(err, &perr) ||
			len(perr.ExtraInFold) != 1 || perr.ExtraInFold[0] != "specs/a.md" {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("deleted mismatch both directions", func(t *testing.T) {
		m2 := Manifest{Files: m.Files, Deleted: []string{"specs/other.md"}}
		var perr *FoldParityError
		if err := Verify(f, m2); !errors.As(err, &perr) || len(perr.DeletedMismatch) != 2 {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("a deleted path listed as a file", func(t *testing.T) {
		m2 := Manifest{Files: map[string]string{
			"specs/a.md":   m.Files["specs/a.md"],
			"specs/old.md": sha256Hex("old\n"),
		}}
		var perr *FoldParityError
		if err := Verify(f, m2); !errors.As(err, &perr) ||
			len(perr.MissingInFold) != 1 || len(perr.DeletedMismatch) != 1 {
			t.Fatalf("got %v", err)
		}
	})
}
