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

package reqspec

import (
	"regexp"
	"strings"
)

// A requirements file, read as far as the contract needs: its title, then
// each `## ` section's list items and paragraphs. A list item's wrapped lines
// join into one line of text; items nested under it (a blocking question's
// answers) are its children.
type document struct {
	title    string
	sections []section
}

type section struct {
	title      string
	items      []item
	paragraphs []string
}

type item struct {
	text     string
	children []string
}

// lines is every line of text in the section: each item, its children, and
// each paragraph.
func (s section) lines() []string {
	var out []string
	for _, it := range s.items {
		out = append(out, it.text)
		out = append(out, it.children...)
	}
	return append(out, s.paragraphs...)
}

// section returns the first section with the title, or an empty one.
func (d document) section(title string) section {
	for _, s := range d.sections {
		if strings.EqualFold(s.title, title) {
			return s
		}
	}
	return section{}
}

var listItemRE = regexp.MustCompile(`^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$`)

// readDoc reads markdown line by line. It understands exactly what the
// contract writes — headings, flat lists with one nested level, paragraphs —
// and treats anything else as paragraph text.
func readDoc(content string) document {
	var doc document
	var cur *section
	// Where a continuation line goes: the open item (or its last child), or
	// the open paragraph. Both close on a blank line, except that an indented
	// line after a blank still continues the item.
	var (
		inItem, inChild, inPara bool
		sawBlank                bool
	)
	closeAll := func() { inItem, inChild, inPara = false, false, false }

	appendTo := func(dst *string, text string) {
		if *dst == "" {
			*dst = text
		} else {
			*dst += " " + text
		}
	}

	for _, raw := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(raw)
		switch {
		case trimmed == "":
			sawBlank = true
			inPara = false
			continue
		case strings.HasPrefix(trimmed, "## "):
			doc.sections = append(doc.sections, section{title: strings.TrimSpace(trimmed[3:])})
			cur = &doc.sections[len(doc.sections)-1]
			closeAll()
		case strings.HasPrefix(trimmed, "# ") && doc.title == "" && cur == nil:
			doc.title = strings.TrimSpace(trimmed[2:])
		case strings.HasPrefix(trimmed, "#"):
			closeAll()
		case cur == nil:
			// Text above the first section: nothing the contract reads.
		default:
			indent := len(raw) - len(strings.TrimLeft(raw, " \t"))
			if m := listItemRE.FindStringSubmatch(raw); m != nil {
				text := strings.TrimSpace(m[2])
				if len(m[1]) >= 2 && inItem {
					last := &cur.items[len(cur.items)-1]
					last.children = append(last.children, text)
					inChild = true
				} else {
					cur.items = append(cur.items, item{text: text})
					inItem, inChild = true, false
				}
				inPara = false
			} else if inItem && (!sawBlank || indent >= 2) {
				last := &cur.items[len(cur.items)-1]
				if inChild {
					appendTo(&last.children[len(last.children)-1], trimmed)
				} else {
					appendTo(&last.text, trimmed)
				}
			} else if inPara {
				appendTo(&cur.paragraphs[len(cur.paragraphs)-1], trimmed)
			} else {
				cur.paragraphs = append(cur.paragraphs, trimmed)
				inItem, inChild, inPara = false, false, true
			}
		}
		sawBlank = false
	}
	return doc
}
