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

package taskplan

import (
	"fmt"
	"regexp"
	"strings"
)

// The items a plan names besides a carried feature's ID.
const (
	FoundationItem = "foundation"
	WholeSpecItem  = "spec"
)

// BuildIssue is what a version's one build issue states: its facts, from the
// tag, and the planner's checklist. The body is prose for the coding agent,
// with ONE platform reader: UncheckedItems counts its unticked `- [ ] **<item>**`
// lines, which is how the run supervisor sees a cycle that ticked an item as
// progress. The lead agent ticks an item when its commit is pushed, and a
// commit message ends `(#<issue> <item>)`, so the item's ID leads its line.
type BuildIssue struct {
	// Version is the spec version: the tag, and the milestone's title.
	Version string
	// FeatureNames maps a carried feature's ID to its name.
	FeatureNames map[string]string
	// ProductWide are the product-wide items the version carries, by ID.
	ProductWide []string
	// HeldBack are the stories the version holds back, by ID.
	HeldBack []string
	Items    []BuildPlanItem
}

// Title is the issue's title.
func (b BuildIssue) Title() string { return "Build " + b.Version }

// Body is the issue's body: the version, the checklist in order, then the
// product-wide items and the held-back stories when there are any.
func (b BuildIssue) Body() string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Version `%s`: the spec is `specs/` at tag `%s`.\n\n", b.Version, b.Version)
	for _, it := range b.Items {
		fmt.Fprintf(&sb, "- [ ] **%s** %s", it.Item, b.label(it.Item))
		if len(it.Components) > 0 {
			sb.WriteString(": `" + strings.Join(it.Components, "`, `") + "`.")
		}
		if note := strings.TrimSpace(it.Note); note != "" {
			sb.WriteString(" " + note)
		}
		sb.WriteString("\n")
	}
	if len(b.ProductWide) > 0 || len(b.HeldBack) > 0 {
		sb.WriteString("\n")
	}
	if len(b.ProductWide) > 0 {
		fmt.Fprintf(&sb, "Product-wide: %s\n", strings.Join(b.ProductWide, ", "))
	}
	if len(b.HeldBack) > 0 {
		fmt.Fprintf(&sb, "Held back: %s\n", strings.Join(b.HeldBack, ", "))
	}
	return sb.String()
}

// label is the words after an item's ID.
func (b BuildIssue) label(item string) string {
	switch item {
	case FoundationItem:
		return "Shared setup and product-wide requirements"
	case WholeSpecItem:
		return "The whole spec"
	}
	if name := b.FeatureNames[item]; name != "" {
		return name
	}
	return "Feature"
}

// uncheckedItemRE matches an item line the coding agent has not ticked yet.
var uncheckedItemRE = regexp.MustCompile(`(?m)^- \[ \] \*\*[^*\n]+\*\*`)

// UncheckedItems counts the items of a build issue's body that are not ticked:
// the work it still holds. The lead ticks an item (`- [x]`) once the item's
// commit is pushed, so a cycle that ticks one has made progress even when the
// issue stays open.
func UncheckedItems(body string) int {
	return len(uncheckedItemRE.FindAllStringIndex(body, -1))
}
