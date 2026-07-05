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

package task

import (
	_ "embed"
	"sync"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
)

// The task-planning skill is the SINGLE SOURCE OF TRUTH at repo-root
// skills/task-planning (docs/design/agents-generation-migration.md §2). It
// cannot be go:embed-ed across the aep-api Go module boundary, so it is vendored
// here. The Task feature vendors its OWN copy (rather than reusing feature/genai's
// vendored set) because the arch allowlist forbids a task→genai import — the one
// skill the plan turn pushes is cheaper to vendor than to couple the two
// features. TestVendoredTaskPlanningSkillMatchesRepoRoot guards against drift.
// Sync command:
//
//go:generate sh -c "rm -rf assets/skills/task-planning && cp -R ../../../../../skills/task-planning assets/skills/task-planning"
//go:embed assets/skills/task-planning/SKILL.md
var taskPlanningSkillMD string

var (
	taskPlanningSkillOnce sync.Once
	taskPlanningSkill     agentsvc.Skill
)

// loadTaskPlanningSkill returns the vendored task-planning skill pushed on every
// plan turn (progressive disclosure level 1: name + description in the catalog,
// body served on demand via loadSkill).
func loadTaskPlanningSkill() agentsvc.Skill {
	taskPlanningSkillOnce.Do(func() {
		taskPlanningSkill = agentsvc.Skill{
			Name:        "task-planning",
			Description: agentsvc.FrontmatterDescription(taskPlanningSkillMD),
			Content:     taskPlanningSkillMD,
		}
	})
	return taskPlanningSkill
}
