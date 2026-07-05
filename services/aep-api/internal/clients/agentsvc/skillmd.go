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

package agentsvc

import "strings"

// FrontmatterDescription extracts the `description:` field from a SKILL.md's
// leading `---`-fenced YAML frontmatter — the value Skill.Description carries
// into the turn catalog. Descriptions are single-line in the vendored flow
// skills, so a full YAML parser is unnecessary. Shared by every feature that
// vendors a skill for this client (genai, task).
func FrontmatterDescription(md string) string {
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
