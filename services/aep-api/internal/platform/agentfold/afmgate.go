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

package agentfold

// afmgate.go — the agent.afm.md write-gate, an accept/reject port of
// packages/agent-stream/src/agent-afm-schema.ts checkAgentAfm (the zod gate
// the TS FileBundle runs on every write). Only the FIRST problem is reported,
// in the same rule order the zod gate evaluates it in, so the first-failure
// message corresponds across both gates — accept/reject parity is what the
// fold needs, not identical wording (message text is log-only, same
// convention as designgate.go).
//
// Deliberately AT MOST as strict as the TS zod gate: fields the zod schema
// requires but this port does not re-check (description non-empty,
// model.name non-empty, interfaces non-empty, x-aep block optionality, ...)
// stay unchecked here, same rationale as validateComponentDesign's optional
// platform-owned blocks — a zod-passing write must always fold, so the Go
// side never needs to be stricter, only never laxer on what it DOES check.

import (
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// afmFrontMatterRe is FRONT_MATTER from agent-afm-schema.ts: the leading
// `---\n<block>\n---` fence followed by the body.
var afmFrontMatterRe = regexp.MustCompile(`^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$`)

// envRefPattern mirrors the zod gate's envRef: a value the platform injects.
// A literal here reaches git.
var envRefPattern = regexp.MustCompile(`^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$`)

// afmUnsupportedKeys mirrors UNSUPPORTED in agent-afm-schema.ts: AFM keys the
// spec defines but this platform does not carry yet. A named message says
// the truth — the field is real, we do not support it — instead of reading
// like a typo (which a generic unknown-property error would).
var afmUnsupportedKeys = map[string]string{
	"tools":  "MCP tools are not supported — an agent reaches our services over their OpenAPI contracts (x-aep.tools.openapi)",
	"skills": "agent skills are not supported in this version",
}

type afmFrontMatter struct {
	SpecVersion   string `yaml:"spec_version"`
	Name          string `yaml:"name"`
	Description   string `yaml:"description"`
	MaxIterations *int   `yaml:"max_iterations"`
	Model         struct {
		Provider       string `yaml:"provider"`
		Name           string `yaml:"name"`
		URL            string `yaml:"url"`
		Authentication struct {
			Type   string `yaml:"type"`
			APIKey string `yaml:"api_key"`
		} `yaml:"authentication"`
	} `yaml:"model"`
	Interfaces []struct {
		Type string `yaml:"type"`
	} `yaml:"interfaces"`
	XAep struct {
		Tools struct {
			OpenAPI []struct {
				Component string   `yaml:"component"`
				BaseURL   string   `yaml:"baseUrl"`
				Allow     []string `yaml:"allow"`
			} `yaml:"openapi"`
		} `yaml:"tools"`
	} `yaml:"x-aep"`
}

// afmModelProviders mirrors the zod gate's model.provider enum. Decides which
// AI SDK adapter the build compiles against — a v1 constraint, not a
// preference; do not widen without widening the zod gate first.
var afmModelProviders = map[string]bool{"anthropic": true, "openai": true}

// validateAgentAfm mirrors checkAgentAfm: parse the `---` front matter fence,
// reject the named-unsupported AFM keys, strict-decode the rest (unknown
// properties reject the way zod's strictObject does), then walk the same
// field checks in the same order so the first failure corresponds.
func validateAgentAfm(content, dirName string) *designProblem {
	m := afmFrontMatterRe.FindStringSubmatch(content)
	if m == nil {
		return &designProblem{code: ErrInvalidJSON, message: "no parseable YAML front matter — not an AFM document"}
	}
	fmBlock, body := m[1], m[2]

	var raw map[string]any
	if err := yaml.Unmarshal([]byte(fmBlock), &raw); err != nil {
		return &designProblem{code: ErrInvalidJSON, message: "no parseable YAML front matter — not an AFM document"}
	}
	for _, key := range []string{"tools", "skills"} {
		if _, present := raw[key]; present {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("%s: %s", key, afmUnsupportedKeys[key])}
		}
	}

	dec := yaml.NewDecoder(strings.NewReader(fmBlock))
	dec.KnownFields(true)
	var fm afmFrontMatter
	if err := dec.Decode(&fm); err != nil {
		return &designProblem{code: ErrSchemaViolation, message: err.Error()}
	}

	if fm.SpecVersion != "0.4.0" {
		return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("spec_version: %q is not an allowed value", fm.SpecVersion)}
	}
	if fm.Name != dirName {
		return &designProblem{
			code:    ErrSchemaViolation,
			message: fmt.Sprintf("name %q must equal the component directory name %q", fm.Name, dirName),
		}
	}
	if !afmModelProviders[fm.Model.Provider] {
		return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("model.provider: %q is not an allowed value", fm.Model.Provider)}
	}
	if !envRefPattern.MatchString(fm.Model.URL) {
		return &designProblem{code: ErrSchemaViolation, message: "model.url: must be an ${env:...} reference"}
	}
	if !envRefPattern.MatchString(fm.Model.Authentication.APIKey) {
		return &designProblem{code: ErrSchemaViolation, message: "model.authentication.api_key: must be an ${env:...} reference"}
	}
	for i, iface := range fm.Interfaces {
		if iface.Type != "webchat" {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("interfaces[%d].type: %q is not an allowed value — only \"webchat\" is supported", i, iface.Type)}
		}
	}
	for i, tool := range fm.XAep.Tools.OpenAPI {
		if !envRefPattern.MatchString(tool.BaseURL) {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("x-aep.tools.openapi[%d].baseUrl: must be an ${env:...} reference", i)}
		}
		if len(tool.Allow) == 0 {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("x-aep.tools.openapi[%d].allow: must contain at least one operationId", i)}
		}
	}
	for _, section := range []string{"# Role", "# Instructions"} {
		if !strings.Contains(body, section) {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("body must contain a %s section", section)}
		}
	}
	return nil
}
