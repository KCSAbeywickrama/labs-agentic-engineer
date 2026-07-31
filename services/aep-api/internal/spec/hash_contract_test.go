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

// The cross-language hash contract (skills-experience spec §5): these
// fixtures + expected.json pin contentSHA byte-for-byte. The TS side
// (@aep/skills-delivery, workstream B) must hash the SAME fixtures to the
// SAME digests. Any change to contentSHA is a breaking contract change and
// must update expected.json + the TS twin together.
package spec

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContentSHA_MatchesHashContract(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join("testdata", "hashcontract", "expected.json"))
	if err != nil {
		t.Fatalf("read expected.json: %v", err)
	}
	var expected map[string]string
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatalf("parse expected.json: %v", err)
	}
	for name, want := range expected {
		dir := filepath.Join("testdata", "hashcontract", name)
		body, err := os.ReadFile(filepath.Join(dir, "SKILL.md"))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		refs := map[string]string{}
		if entries, err := os.ReadDir(filepath.Join(dir, "references")); err == nil {
			for _, e := range entries {
				if !strings.HasSuffix(e.Name(), ".md") {
					continue
				}
				data, err := os.ReadFile(filepath.Join(dir, "references", e.Name()))
				if err != nil {
					t.Fatalf("%s ref %s: %v", name, e.Name(), err)
				}
				refs["references/"+e.Name()] = string(data)
			}
		}
		got := contentSHA(string(body), refs)
		if got != want {
			t.Fatalf("hash contract broken for %q:\n got  %s\n want %s\n(if the change is intentional, update expected.json AND the TS twin)", name, got, want)
		}
	}
}
