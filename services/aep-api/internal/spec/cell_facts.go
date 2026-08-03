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

// cell_facts.go — the BFF's read of specs/design/design.cell (spec-agent
// redesign #370/#371). The cell is the PRIMARY design source: it declares the
// design version's one PRD phase (`phase <N>`) and each component's story
// citations (`component <id> … [stories: 1, 2]`). The scaffold engine and the
// build-tag gate consume these FACTS — phase, components with types + cited
// stories — not the diagram semantics; the TS parser
// (packages/ui/cell-diagram-react) stays the authoritative grammar validator
// for rendering, so this extractor is deliberately permissive: statements it
// does not recognize are skipped, and only the facts it DOES extract are
// validated (a malformed phase or stories suffix is an error, never a guess).

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// CellComponent is one `component` statement's extracted facts.
type CellComponent struct {
	ID      string
	Type    string
	Stories []int
}

// CellFacts is everything the platform reads from a design.cell.
type CellFacts struct {
	// Phase is the one PRD phase this design version details; 0 when the cell
	// declares none (the tag gate treats that as its own failure).
	Phase      int
	Components []CellComponent
}

var storiesSuffixPattern = regexp.MustCompile(`^(.*?)\s*\[\s*[sS]tories\s*:([^\]]*)\]\s*$`)

// parseCellFacts extracts the platform-relevant facts from design.cell source.
func parseCellFacts(source string) (*CellFacts, error) {
	facts := &CellFacts{}
	for i, rawLine := range strings.Split(source, "\n") {
		line := i + 1
		statement := strings.TrimSpace(rawLine)
		if statement == "" || strings.HasPrefix(statement, "#") || strings.HasPrefix(statement, "//") {
			continue
		}

		if statement == "phase" || strings.HasPrefix(statement, "phase ") {
			value, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(statement, "phase")))
			if err != nil || value <= 0 {
				return nil, fmt.Errorf("design.cell line %d: phase must be a positive integer", line)
			}
			facts.Phase = value
			continue
		}

		if strings.HasPrefix(statement, "component ") {
			component, err := parseCellComponent(statement, line)
			if err != nil {
				return nil, err
			}
			facts.Components = append(facts.Components, component)
			continue
		}
		// Everything else (title, version, externals, edges, unknown lines) is
		// the TS validator's business, not a fact this extractor needs.
	}
	return facts, nil
}

func parseCellComponent(statement string, line int) (CellComponent, error) {
	body := statement
	var stories []int
	if m := storiesSuffixPattern.FindStringSubmatch(statement); m != nil {
		body = strings.TrimSpace(m[1])
		items := strings.FieldsFunc(m[2], func(r rune) bool { return r == ',' || r == ' ' || r == '\t' })
		if len(items) == 0 {
			return CellComponent{}, fmt.Errorf("design.cell line %d: empty stories suffix", line)
		}
		for _, item := range items {
			n, err := strconv.Atoi(item)
			if err != nil || n <= 0 {
				return CellComponent{}, fmt.Errorf("design.cell line %d: story numbers must be positive integers", line)
			}
			stories = append(stories, n)
		}
	}

	tokens := tokenizeCellStatement(body)
	if len(tokens) < 2 {
		return CellComponent{}, fmt.Errorf("design.cell line %d: component statement needs an id", line)
	}
	component := CellComponent{ID: tokens[1], Stories: stories}
	rest := tokens[2:]
	if len(rest) > 0 {
		if rest[0] == "as" {
			// With `as`, the LAST token is the type when two or more follow the
			// label start; a single trailing token is label-only (TS grammar).
			if len(rest) >= 3 {
				component.Type = rest[len(rest)-1]
			}
		} else {
			component.Type = strings.Join(rest, " ")
		}
	}
	return component, nil
}

// tokenizeCellStatement splits on whitespace, keeping double-quoted runs as
// one token (mirrors the TS tokenizer).
var cellTokenPattern = regexp.MustCompile(`"([^"]*)"|(\S+)`)

func tokenizeCellStatement(statement string) []string {
	matches := cellTokenPattern.FindAllStringSubmatch(statement, -1)
	tokens := make([]string, 0, len(matches))
	for _, m := range matches {
		if m[1] != "" || strings.HasPrefix(m[0], `"`) {
			tokens = append(tokens, m[1])
		} else {
			tokens = append(tokens, m[2])
		}
	}
	return tokens
}

// CitedStories returns every story number cited anywhere in the cell,
// deduplicated and sorted.
func (f *CellFacts) CitedStories() []int {
	seen := map[int]bool{}
	for _, c := range f.Components {
		for _, n := range c.Stories {
			seen[n] = true
		}
	}
	out := make([]int, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Ints(out)
	return out
}

// IsStub reports whether a component is a STUB for the given in-scope story
// set (#370/#371 derivation, no marker keyword): it cites at least one story
// and every story it cites falls outside the scope. A component citing nothing
// (infrastructure like a database) is never a stub — it has no detail the
// phase gates.
func (f *CellFacts) IsStub(componentID string, inScope map[int]bool) bool {
	for _, c := range f.Components {
		if c.ID != componentID {
			continue
		}
		if len(c.Stories) == 0 {
			return false
		}
		for _, n := range c.Stories {
			if inScope[n] {
				return false
			}
		}
		return true
	}
	return false
}
