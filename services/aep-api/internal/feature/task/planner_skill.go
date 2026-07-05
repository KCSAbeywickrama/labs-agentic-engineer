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
	"log/slog"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"

	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	embedskills "github.com/wso2/aep/aep-api/skills"
)

// The task-breakdown skill is embedded (never org-repo-sourced): it is planner
// guidance, not a design-attachable coding skill, so it is not bootstrapped
// into the `skills` table the way the architect's builtins are. It is loaded
// once from the embedded FS and pushed on every plan/detail request. This
// mirrors how the architect always has its builtins present (embedded), so
// there is no "org repo lacks it" branch — the embedded copy IS the default.
var (
	taskBreakdownOnce  sync.Once
	taskBreakdownSkill *agents.SkillRecord
)

// loadTaskBreakdownSkill reads + parses the embedded task-breakdown SKILL.md
// into a wire SkillRecord (name/description from the frontmatter; Body is the
// full SKILL.md, matching the SkillMD convention the architect/detail pushes
// use). A parse failure logs and returns nil so the planner degrades to its
// built-in fallback rather than failing the stream.
func loadTaskBreakdownSkill() *agents.SkillRecord {
	taskBreakdownOnce.Do(func() {
		raw, err := embedskills.PlannerFS.ReadFile(embedskills.TaskBreakdownSkillPath)
		if err != nil {
			slog.Error("task-planner: embedded task-breakdown skill read failed", "error", err)
			return
		}
		fm, _, err := artifacts.SplitFrontmatter(string(raw))
		if err != nil {
			slog.Error("task-planner: task-breakdown skill frontmatter split failed", "error", err)
			return
		}
		var meta struct {
			Name        string `yaml:"name"`
			Description string `yaml:"description"`
		}
		if err := yaml.Unmarshal([]byte(fm), &meta); err != nil {
			slog.Error("task-planner: task-breakdown skill frontmatter decode failed", "error", err)
			return
		}
		if strings.TrimSpace(meta.Name) == "" {
			slog.Error("task-planner: task-breakdown skill missing frontmatter name")
			return
		}
		taskBreakdownSkill = &agents.SkillRecord{
			Name:        strings.TrimSpace(meta.Name),
			Description: strings.TrimSpace(meta.Description),
			Body:        string(raw),
		}
	})
	return taskBreakdownSkill
}
