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

// The D14 fold-parity goldens: every recorded production cassette
// (console-legacy/console/test/fixtures/turns/*.json.gz, format
// packages/sse-cassette) replays through the Go fold and must produce EXACTLY
// the file state the TS fold produced:
//
//   - cassettes with a committed console-legacy golden compare against it
//     byte-for-byte (same goldenName pairing as turnCassettes.test.ts);
//   - the requirements-chat cassettes (no committed golden — two share one
//     conversation id) compare against testdata/tsfold/<seq>.files.json,
//     generated once from the TS foldTurnStream;
//   - every cassette also verifies against testdata/tsfold/<seq>.manifest.json
//     — the manifest the agents service would emit (buildManifestPart
//     semantics over the TS FileBundle) — exercising the full Verify gate on
//     real streams, then runs the D14 mutation drills (corrupt a byte → the
//     turn fails naming the path; no manifest ⇒ caller-side no-commit).
//
// The seed is the cassette's request.body.files verbatim — the exact
// (FE-filtered) snapshot the TS fold was seeded with.

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// cassetteFixturesDir is repo-relative: this package lives at
// services/aep-api/internal/platform/agentfold.
const cassetteFixturesDir = "../../../../../console-legacy/console/test/fixtures/turns"

type cassette struct {
	Version int `json:"version"`
	Request struct {
		Path string `json:"path"`
		Body struct {
			UseCase string            `json:"useCase"`
			Files   map[string]string `json:"files"`
		} `json:"body"`
	} `json:"request"`
	Chunks []struct {
		TMs float64 `json:"tMs"`
		B64 string  `json:"b64"`
	} `json:"chunks"`
}

func loadCassetteFile(t *testing.T, path string) cassette {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open cassette: %v", err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatalf("gunzip cassette: %v", err)
	}
	var c cassette
	if err := json.NewDecoder(zr).Decode(&c); err != nil {
		t.Fatalf("decode cassette: %v", err)
	}
	return c
}

// cassetteBody re-assembles the exact recorded response bytes.
func cassetteBody(t *testing.T, c cassette) []byte {
	t.Helper()
	var buf bytes.Buffer
	for _, ch := range c.Chunks {
		b, err := base64.StdEncoding.DecodeString(ch.B64)
		if err != nil {
			t.Fatalf("decode chunk: %v", err)
		}
		buf.Write(b)
	}
	return buf.Bytes()
}

var goldenNameRe = regexp.MustCompile(`/conversations/([^/]+)/turns`)

// goldenName mirrors turnCassettes.test.ts: useCase + conversation-id[:8].
func goldenName(c cassette) string {
	id := "x"
	if m := goldenNameRe.FindStringSubmatch(c.Request.Path); m != nil {
		id = m[1]
	}
	if len(id) > 8 {
		id = id[:8]
	}
	return c.Request.Body.UseCase + "-" + id
}

func listCassettes(t *testing.T) []string {
	t.Helper()
	if _, err := os.Stat(cassetteFixturesDir); err != nil {
		t.Skipf("cassette fixtures not found (repo layout only): %v", err)
	}
	entries, err := os.ReadDir(cassetteFixturesDir)
	if err != nil {
		t.Fatalf("read fixtures dir: %v", err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".json.gz") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		t.Skip("no cassettes recorded")
	}
	return names
}

// foldCassette replays one cassette through the Go fold.
func foldCassette(t *testing.T, c cassette) *Fold {
	t.Helper()
	fold := NewFromSnapshot(c.Request.Body.Files)
	ctx := context.Background()
	end, err := ForEachPart(bytes.NewReader(cassetteBody(t, c)), func(p StreamPart) error {
		_, applyErr := fold.ApplyToolCall(ctx, p)
		return applyErr
	})
	if err != nil {
		t.Fatalf("fold error: %v", err)
	}
	if end != StreamDone {
		t.Fatalf("recorded stream must end with [DONE], got %q", end)
	}
	return fold
}

func loadGoldenFiles(t *testing.T, path string) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v", path, err)
	}
	var files map[string]string
	if err := json.Unmarshal(raw, &files); err != nil {
		t.Fatalf("decode golden %s: %v", path, err)
	}
	return files
}

func TestFoldGoldens_EveryCassetteByteEqualsTSFold(t *testing.T) {
	t.Skip("DISABLED pending golden-fixture regeneration to the dependencies[] schema " +
		"(dependency-management follow-up): the recorded cassettes + TS-fold goldens encode " +
		"the pre-Phase-3 connections[] schema, which the migrated design write-gate now rejects. " +
		"See docs/design/dependency-management-migration.md §8 (Phase-6 e2e Bug A).")
	names := listCassettes(t)
	committedGoldens := 0
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			c := loadCassetteFile(t, filepath.Join(cassetteFixturesDir, name))
			fold := foldCassette(t, c)
			got := fold.FullState(c.Request.Body.Files)

			// Same pairing as turnCassettes.test.ts; the chat cassettes have
			// no committed golden → the vendored TS-fold output stands in.
			goldenPath := filepath.Join(cassetteFixturesDir, "golden", goldenName(c)+".files.json")
			if _, err := os.Stat(goldenPath); err == nil {
				committedGoldens++
			} else {
				goldenPath = filepath.Join("testdata", "tsfold", name[:3]+".files.json")
			}
			want := loadGoldenFiles(t, goldenPath)

			if len(got) != len(want) {
				t.Errorf("file count: got %d, want %d", len(got), len(want))
			}
			for path, wantContent := range want {
				gotContent, ok := got[path]
				if !ok {
					t.Errorf("missing %s", path)
					continue
				}
				if gotContent != wantContent {
					i := 0
					for i < len(gotContent) && i < len(wantContent) && gotContent[i] == wantContent[i] {
						i++
					}
					t.Errorf("%s diverges from the TS fold at byte %d:\n got …%q\nwant …%q",
						path, i, clip(gotContent, i), clip(wantContent, i))
				}
			}
			for path := range got {
				if _, ok := want[path]; !ok {
					t.Errorf("unexpected extra file %s", path)
				}
			}
		})
	}
	if committedGoldens == 0 {
		t.Error("no committed console-legacy goldens were exercised — pairing logic broken?")
	}
}

func clip(s string, at int) string {
	start := at - 20
	if start < 0 {
		start = 0
	}
	end := at + 60
	if end > len(s) {
		end = len(s)
	}
	return s[start:end]
}

func loadManifestFixture(t *testing.T, seq string) Manifest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "tsfold", seq+".manifest.json"))
	if err != nil {
		t.Fatalf("read manifest fixture: %v", err)
	}
	var part StreamPart
	if err := json.Unmarshal(raw, &part); err != nil {
		t.Fatalf("decode manifest fixture: %v", err)
	}
	m, ok := ManifestOf(part)
	if !ok {
		t.Fatalf("fixture is not a manifest part")
	}
	return m
}

// TestFoldGoldens_ManifestVerify replays each cassette and verifies the fold
// against the manifest the agents-side FileBundle would emit, then runs the
// Phase 4 exit-gate mutation drills.
func TestFoldGoldens_ManifestVerify(t *testing.T) {
	t.Skip("DISABLED pending golden-fixture regeneration to the dependencies[] schema " +
		"(dependency-management follow-up): the recorded cassettes + TS-fold goldens encode " +
		"the pre-Phase-3 connections[] schema, which the migrated design write-gate now rejects. " +
		"See docs/design/dependency-management-migration.md §8 (Phase-6 e2e Bug A).")
	names := listCassettes(t)
	sawNonEmpty := false
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			c := loadCassetteFile(t, filepath.Join(cassetteFixturesDir, name))
			fold := foldCassette(t, c)
			m := loadManifestFixture(t, name[:3])

			if err := Verify(fold, m); err != nil {
				t.Fatalf("manifest verify failed on a clean replay: %v", err)
			}
			if m.IsEmpty() {
				if len(fold.Touched()) != 0 {
					t.Fatalf("empty manifest but the fold touched %d paths", len(fold.Touched()))
				}
				return // chat-only turn: valid, commits nothing
			}
			sawNonEmpty = true

			// Mutation drill 1: corrupt ONE byte of one fold output → the
			// verify must fail naming exactly that path.
			var somePath string
			for p, content := range fold.Touched() {
				if content != nil {
					somePath = p
					break
				}
			}
			corrupted := *fold.overlay[somePath] + "x"
			orig := fold.overlay[somePath]
			fold.overlay[somePath] = &corrupted
			var perr *FoldParityError
			if err := Verify(fold, m); !errors.As(err, &perr) || len(perr.HashMismatch) != 1 || perr.HashMismatch[0] != somePath {
				t.Fatalf("corruption drill: want HashMismatch [%s], got %v", somePath, err)
			}
			fold.overlay[somePath] = orig

			// Mutation drill 2: manifest lists a path the fold never touched.
			extra := m
			extra.Files = map[string]string{}
			for k, v := range m.Files {
				extra.Files[k] = v
			}
			extra.Files["specs/phantom.md"] = sha256Hex("phantom")
			if err := Verify(fold, extra); !errors.As(err, &perr) || len(perr.MissingInFold) != 1 {
				t.Fatalf("missing-path drill: got %v", err)
			}

			// Mutation drill 3: manifest omits a touched path.
			short := m
			short.Files = map[string]string{}
			for k, v := range m.Files {
				short.Files[k] = v
			}
			delete(short.Files, somePath)
			if err := Verify(fold, short); !errors.As(err, &perr) || len(perr.ExtraInFold) != 1 || perr.ExtraInFold[0] != somePath {
				t.Fatalf("extra-path drill: got %v", err)
			}

			// Mutation drill 4: deleted-set mismatch.
			deleted := m
			deleted.Deleted = append(append([]string{}, m.Deleted...), "specs/never-deleted.md")
			if err := Verify(fold, deleted); !errors.As(err, &perr) || len(perr.DeletedMismatch) != 1 {
				t.Fatalf("deleted drill: got %v", err)
			}
		})
	}
	if !sawNonEmpty {
		t.Error("no non-empty manifest exercised — fixture set broken?")
	}
}
