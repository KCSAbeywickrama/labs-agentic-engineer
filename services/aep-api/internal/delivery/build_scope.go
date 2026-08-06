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

package delivery

// build_scope.go — the platform-stamped "Serves stories" traceability block on
// task issues (spec-agent redesign #369): platform-authored with zero LLM
// discretion — the planner never writes it, the plan tap stamps it from the
// design's citations, and delta planning reads it back to compute coverage.

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ---- the platform-stamped "Serves stories" block (#369) ---------------------

// servesStoriesHeader opens the platform-stamped traceability block on a task
// issue body. The stamp is platform-authored with zero LLM discretion — the
// planner never writes it, the tap appends it from the design's citations.
const servesStoriesHeader = "**Serves stories:**"

var servesStoriesLinePattern = regexp.MustCompile(`(?m)^\*\*Serves stories:\*\*\s*([\d,\s]+)$`)

// ServesStoriesBlock renders the stamp for a task issue body; "" when the
// component cites no in-scope stories.
func ServesStoriesBlock(stories []int) string {
	if len(stories) == 0 {
		return ""
	}
	parts := make([]string, len(stories))
	for i, n := range stories {
		parts[i] = strconv.Itoa(n)
	}
	return "\n\n" + servesStoriesHeader + " " + strings.Join(parts, ", ") + "\n"
}

// StampServesStories returns body with the stamp present exactly once: an
// existing stamp is replaced (a body rewrite must not duplicate or drop it),
// otherwise the block is appended. An empty stories list strips the stamp.
func StampServesStories(body string, stories []int) string {
	stripped := servesStoriesLinePattern.ReplaceAllString(body, "")
	stripped = strings.TrimRight(stripped, "\n")
	block := ServesStoriesBlock(stories)
	if block == "" {
		return stripped + "\n"
	}
	return stripped + block
}

// ParseServesStories extracts the stamped story numbers from a task issue
// body; nil when no stamp is present.
func ParseServesStories(body string) []int {
	m := servesStoriesLinePattern.FindStringSubmatch(body)
	if m == nil {
		return nil
	}
	var out []int
	for _, tok := range strings.FieldsFunc(m[1], func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' || r == '\r' }) {
		if n, err := strconv.Atoi(tok); err == nil && n > 0 {
			out = append(out, n)
		}
	}
	sort.Ints(out)
	return out
}
