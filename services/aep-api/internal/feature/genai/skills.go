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

package genai

import (
	"embed"
	"io/fs"
	"strings"
	"sync"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
)

// Core flow skills are the SINGLE SOURCE OF TRUTH at the repo-root skills/
// directory (docs/design/agents-generation-migration.md §2). They cannot be
// go:embed-ed across the aep-api Go module boundary, so they are vendored here
// under assets/skills/ and MUST be kept in sync with repo-root skills/. The
// evals + playground read the repo-root copy; this vendored copy is what the
// BFF pushes. Sync command:
//
//go:generate sh -c "rm -rf assets/skills && cp -R ../../../../../skills assets/skills"
//go:embed assets/skills
var flowSkillsFS embed.FS

const flowSkillsRoot = "assets/skills"

// coreSkillsByUseCase maps a use case to the core flow skills pushed for it. The
// three flow skills are all DESIGN-shaped (high-level-architecture drives the
// design tree; excalidraw-wireframes + openapi-conventions carry the derived
// artifacts), so only design-generate pushes them. Requirements flows push no
// core skill — their steering line carries the whole directive; org auxiliary
// skills (pushed for every use case) still ride along.
var coreSkillsByUseCase = map[string][]string{
	useCaseRequirementsGenerate: {},
	useCaseRequirementsChat:     {},
	useCaseDesignGenerate:       {"high-level-architecture", "excalidraw-wireframes", "openapi-conventions"},
}

// steeringByUseCase is the explicit action-steer appended to the instruction so
// the model loads the right skill(s) from the catalog and produces the right
// artifacts. There is no pinned-skill param — routing is steering line + model
// choice (§2).
var steeringByUseCase = map[string]string{
	useCaseRequirementsGenerate: "\n\nGenerate the requirements document at specs/requirements/requirements.md from the direction above. Write clear, well-structured markdown.",
	useCaseRequirementsChat:     "\n\nApply the requested change to the current requirements draft, or answer the question if no change is requested.",
	useCaseDesignGenerate:       "\n\nGenerate the design under specs/design/ from the approved requirements above. Consult the high-level-architecture skill for the design tree, and produce each component's design.json, plus openapi.yaml for services and wireframes.dsl for web apps as the skills direct.",
}

var (
	flowSkillsOnce   sync.Once
	flowSkillsByName map[string]agentsvc.Skill
	flowSkillsErr    error
)

// loadFlowSkills parses the embedded flow-skill tree once into name → Skill,
// carrying the SKILL.md body as content and every references/*.md file as the
// references map (progressive-disclosure level 3).
func loadFlowSkills() (map[string]agentsvc.Skill, error) {
	flowSkillsOnce.Do(func() {
		flowSkillsByName = map[string]agentsvc.Skill{}
		entries, err := fs.ReadDir(flowSkillsFS, flowSkillsRoot)
		if err != nil {
			flowSkillsErr = err
			return
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			body, err := fs.ReadFile(flowSkillsFS, flowSkillsRoot+"/"+name+"/SKILL.md")
			if err != nil {
				continue // a dir without a SKILL.md is not a skill
			}
			refs := map[string]string{}
			refDir := flowSkillsRoot + "/" + name + "/references"
			if refEntries, err := fs.ReadDir(flowSkillsFS, refDir); err == nil {
				for _, r := range refEntries {
					if r.IsDir() {
						continue
					}
					data, err := fs.ReadFile(flowSkillsFS, refDir+"/"+r.Name())
					if err != nil {
						continue
					}
					refs["references/"+r.Name()] = string(data)
				}
			}
			flowSkillsByName[name] = agentsvc.Skill{
				Name:        name,
				Description: frontmatterDescription(string(body)),
				Content:     string(body),
				References:  refs,
			}
		}
	})
	return flowSkillsByName, flowSkillsErr
}

// coreSkillsFor returns the embedded core skills to push for a use case.
func coreSkillsFor(useCase string) ([]agentsvc.Skill, error) {
	names := coreSkillsByUseCase[useCase]
	if len(names) == 0 {
		return nil, nil
	}
	byName, err := loadFlowSkills()
	if err != nil {
		return nil, err
	}
	out := make([]agentsvc.Skill, 0, len(names))
	for _, n := range names {
		if sk, ok := byName[n]; ok {
			out = append(out, sk)
		}
	}
	return out, nil
}

// frontmatterDescription extracts the `description:` field from a SKILL.md's
// leading `---`-fenced YAML frontmatter. Descriptions are single-line in the
// flow skills, so a full YAML parser is unnecessary.
func frontmatterDescription(md string) string {
	lines := strings.Split(md, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return ""
	}
	for _, ln := range lines[1:] {
		if strings.TrimSpace(ln) == "---" {
			break
		}
		if rest, ok := strings.CutPrefix(strings.TrimSpace(ln), "description:"); ok {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}
