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

package taskplan

import (
	"strings"
	"testing"
)

func TestBuildIssueRender(t *testing.T) {
	issue := BuildIssue{
		Version:      "v2",
		FeatureNames: map[string]string{"F1": "Greeting page", "F3": "Edit greeting"},
		ProductWide:  []string{"P1"},
		HeldBack:     []string{"F3.4"},
		Items: []BuildPlanItem{
			{Item: FoundationItem, Components: []string{"hello-api", "hello-webapp"}, Note: "Sign-in on both."},
			{Item: "F1", Components: []string{"hello-api", "hello-webapp"}, Note: " The greeting. "},
			{Item: "F3", Components: []string{"hello-api"}},
		},
	}
	if got := issue.Title(); got != "Build v2" {
		t.Fatalf("title %q", got)
	}
	want := "Version `v2`: the spec is `specs/` at tag `v2`.\n\n" +
		"- [ ] **foundation** Shared setup and product-wide requirements: `hello-api`, `hello-webapp`. Sign-in on both.\n" +
		"- [ ] **F1** Greeting page: `hello-api`, `hello-webapp`. The greeting.\n" +
		"- [ ] **F3** Edit greeting: `hello-api`.\n" +
		"\nProduct-wide: P1\nHeld back: F3.4\n"
	if got := issue.Body(); got != want {
		t.Fatalf("body:\n%s\nwant:\n%s", got, want)
	}

	whole := BuildIssue{Version: "v1", Items: []BuildPlanItem{{Item: WholeSpecItem, Components: []string{"api"}, Note: "All of it."}}}
	if got, want := whole.Body(), "Version `v1`: the spec is `specs/` at tag `v1`.\n\n- [ ] **spec** The whole spec: `api`. All of it.\n"; got != want {
		t.Fatalf("whole-spec body:\n%s\nwant:\n%s", got, want)
	}
}

func TestUncheckedItems(t *testing.T) {
	body := BuildIssue{Version: "v1", Items: []BuildPlanItem{{Item: "foundation"}, {Item: "F1"}, {Item: "F2"}}}.Body()
	if got := UncheckedItems(body); got != 3 {
		t.Fatalf("a fresh build issue has %d unchecked items, want 3", got)
	}
	ticked := strings.Replace(body, "- [ ] **foundation**", "- [x] **foundation**", 1)
	if got := UncheckedItems(ticked); got != 2 {
		t.Fatalf("after ticking foundation: %d, want 2", got)
	}
	if got := UncheckedItems("A bug report.\n- [ ] not an item line\n"); got != 0 {
		t.Fatalf("a body with no item lines: %d, want 0", got)
	}
}
