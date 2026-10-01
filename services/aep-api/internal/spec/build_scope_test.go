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

import (
	"fmt"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/reqspec"
)

// The build order among a version's features (B3): a file's `Needs:` is
// followed; a story's own need joins unless it would close a loop, and a
// feature an earlier version built is not waited on.
func TestFeatureOrder(t *testing.T) {
	spec := reqspec.Parse(map[string]string{
		"features/F1-claims.md":    "# Claims\n\n## User Stories\n\n- F1.1 Submit. \n- F1.3 See the decision. Needs: F2.\n",
		"features/F2-approvals.md": "# Approvals\n\n## Purpose\n\nDecide claims.\n\nNeeds: F1.\n\n## User Stories\n\n- F2.1 Approve.\n",
		"features/F3-report.md":    "# Report\n\n## Purpose\n\nNeeds: F2.\n\n## User Stories\n\n- F3.1 Total. Needs: F1.\n",
		"features/F4-export.md":    "# Export\n\n## User Stories\n\n- F4.1 Export. Needs: F3.\n",
	})
	got := featureOrder(spec, []string{"F1", "F2", "F3", "F4"})
	want := map[string]string{"F1": "[]", "F2": "[F1]", "F3": "[F1 F2]", "F4": "[F3]"}
	for id, w := range want {
		if fmt.Sprint(got[id]) != w {
			t.Errorf("%s is built after %v, want %s", id, got[id], w)
		}
	}

	// F1 built earlier: F2 waits on nothing this version brings.
	if got := featureOrder(spec, []string{"F2", "F3"}); fmt.Sprint(got["F2"]) != "[]" || fmt.Sprint(got["F3"]) != "[F2]" {
		t.Errorf("with F1 built = %v", got)
	}
}
