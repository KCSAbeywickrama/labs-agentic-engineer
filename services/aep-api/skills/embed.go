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

// Package skills embeds the bundled built-in SKILL.md files into the BFF
// binary so SkillBootstrap.Run() can UPSERT them into the `skills` table
// at startup without depending on a checked-out source tree.
//
// See docs/design/skills-system.md > "Bootstrap".
package skills

import "embed"

//go:embed builtin/*/SKILL.md
var BuiltinFS embed.FS

// PlannerFS carries the planner-facing built-in skills that are NOT part of the
// design-attachable catalogue and are never bootstrapped into the `skills`
// table. Today this is the `task-breakdown` skill the BFF pushes on every
// task-planner plan/detail call (mirrors how BuiltinFS backs the architect's
// builtins, but pushed on the wire directly rather than via the DB catalogue).
// See docs/design/skills-system.md and skills/task-breakdown/SKILL.md.
//
//go:embed planner/task-breakdown/SKILL.md
var PlannerFS embed.FS

// TaskBreakdownSkillPath is the embedded path of the task-breakdown SKILL.md.
const TaskBreakdownSkillPath = "planner/task-breakdown/SKILL.md"
