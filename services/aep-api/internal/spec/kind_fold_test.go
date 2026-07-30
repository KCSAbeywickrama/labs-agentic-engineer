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

package spec

import "testing"

func TestFrontmatterKind_FoldsCustomToOrg(t *testing.T) {
	t.Parallel()
	// A stored SKILL.md that still declares kind: custom must read as org.
	md := "---\nname: acme\ndescription: d\nmetadata:\n  aep:\n    kind: custom\n---\n\nbody\n"
	fm, _, err := parseSkillMD(md)
	if err != nil {
		t.Fatal(err)
	}
	if got := frontmatterKind(fm); got != SkillKindOrg {
		t.Fatalf("custom must fold to org, got %q", got)
	}
}

func TestSkillEditable_OrgAndImportedEditable_PlatformNot(t *testing.T) {
	t.Parallel()
	cases := map[string]bool{SkillKindOrg: true, SkillKindImported: true, SkillKindPlatform: false}
	for kind, want := range cases {
		if got := SkillEditable(kind); got != want {
			t.Fatalf("SkillEditable(%q)=%v want %v", kind, got, want)
		}
	}
}

func TestIsUserKind_ImportedOnly(t *testing.T) {
	t.Parallel()
	if isUserKind(SkillKindOrg) {
		t.Fatal("org is no longer a user-owned kind (seeded org skills are reconcile-managed)")
	}
	if !isUserKind(SkillKindImported) {
		t.Fatal("imported must remain user-owned")
	}
}
