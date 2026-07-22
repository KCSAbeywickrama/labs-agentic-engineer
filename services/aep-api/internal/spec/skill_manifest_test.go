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

// UNIT tier: the skills-manifest.json parse/render pair. Parsing is tolerant
// (a missing or corrupt manifest must never brick reads — spec §3); rendering
// is deterministic (sorted keys, trailing newline) so reconcile commits diff
// cleanly.
package spec

import (
	"bytes"
	"testing"
)

func TestSkillsManifest_ParseRenderRoundTrip(t *testing.T) {
	t.Parallel()
	m := SkillsManifest{
		"go":            {Kind: ManifestKindPlatform, BaseHash: "ab12"},
		"agent-browser": {Kind: ManifestKindImported, Source: "vercel-labs/agent-browser", BaseHash: "cd34"},
	}
	raw := renderSkillsManifest(m)
	got := parseSkillsManifest(raw)
	if len(got) != 2 || got["go"].BaseHash != "ab12" || got["agent-browser"].Source != "vercel-labs/agent-browser" {
		t.Fatalf("round trip lost data: %#v", got)
	}
	if !bytes.HasSuffix(raw, []byte("\n")) {
		t.Fatalf("render must end with a newline: %q", raw)
	}
	// Determinism: two renders of the same map are byte-identical.
	if !bytes.Equal(raw, renderSkillsManifest(m)) {
		t.Fatal("render is not deterministic")
	}
}

func TestSkillsManifest_ParseTolerant(t *testing.T) {
	t.Parallel()
	for name, raw := range map[string][]byte{
		"nil":        nil,
		"empty":      {},
		"corrupt":    []byte("{not json"),
		"wrongShape": []byte(`[1,2,3]`),
	} {
		if got := parseSkillsManifest(raw); got == nil || len(got) != 0 {
			t.Fatalf("%s: want empty non-nil manifest, got %#v", name, got)
		}
	}
}
