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

package skills

import (
	"bytes"
	"os"
	"testing"
)

// repoRootTaskBreakdownSkillPath is the canonical repo-root copy of the
// task-breakdown skill (the one `services/agents`' eval/playground harness and
// any human reader load from `skills/`, per ADR-0002). `PlannerFS` below embeds
// a SECOND copy at planner/task-breakdown/SKILL.md because `go:embed` cannot
// reach outside this module's tree — the two must stay byte-identical.
// services/aep-api/skills/ -> ../ (aep-api) -> ../../ (services) -> ../../../
// is the repo root.
const repoRootTaskBreakdownSkillPath = "../../../skills/task-breakdown/SKILL.md"

// TestPlannerFSTaskBreakdownSkillMatchesRepoRootCopy guards against the
// embedded planner/task-breakdown/SKILL.md silently drifting from the
// repo-root skills/task-breakdown/SKILL.md it mirrors. Nothing enforces that
// an edit to one gets copied to the other, so this test reads both and fails
// loud — with a copy-paste-able fix — the moment they diverge.
func TestPlannerFSTaskBreakdownSkillMatchesRepoRootCopy(t *testing.T) {
	embedded, err := PlannerFS.ReadFile(TaskBreakdownSkillPath)
	if err != nil {
		t.Fatalf("read embedded %s: %v", TaskBreakdownSkillPath, err)
	}

	repoRoot, err := os.ReadFile(repoRootTaskBreakdownSkillPath)
	if err != nil {
		t.Fatalf("read repo-root copy %s: %v", repoRootTaskBreakdownSkillPath, err)
	}

	if !bytes.Equal(embedded, repoRoot) {
		t.Fatalf(
			"embedded %s has drifted from the repo-root copy at %s — these must "+
				"stay byte-identical (skills/task-breakdown/SKILL.md is the single "+
				"authored source; %s is its go:embed-only mirror). Fix: from "+
				"services/aep-api/skills/, run:\n\n"+
				"\tcp %s planner/task-breakdown/SKILL.md\n\n"+
				"then re-run this test.",
			TaskBreakdownSkillPath, repoRootTaskBreakdownSkillPath, TaskBreakdownSkillPath,
			repoRootTaskBreakdownSkillPath,
		)
	}
}
