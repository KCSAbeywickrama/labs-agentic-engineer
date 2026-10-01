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
	"slices"
	"strings"
)

// A feature's design is made from its file and from the product-wide items
// that reach it; when either reads differently, that feature's design is out
// of date (and only that feature's). The console works out the same thing in
// the browser (console-next model/designWork.ts) for the chip it shows.

// Designable reports whether design can take the feature: it has been
// interviewed (it has stories) and no blocking question stops it.
func (f Feature) Designable() bool {
	return len(f.Stories) > 0 && len(f.Blocking) == 0
}

// Basis is the text a feature's design reads, as one string: every line of
// its file by its words (its ID kept, its sources, clauses and closing tag
// dropped), then the words of each product-wide item that applies to it.
// Confirming an assumed line drops a tag and changes no words, so it moves no
// basis. "" when the feature has no file.
func Basis(files map[string]string, featureID string) string {
	var path string
	for rel := range files {
		if m := featureFileRE.FindStringSubmatch(rel); m != nil && m[1] == featureID {
			path = rel
		}
	}
	if path == "" {
		return ""
	}
	doc := readDoc(files[path])
	words := []string{doc.title}
	for _, s := range doc.sections {
		words = append(words, s.title)
		for _, line := range s.lines() {
			words = append(words, lineWords(line))
		}
	}
	for _, it := range Parse(files).ProductWide {
		if slices.Contains(it.AppliesTo, "all") || slices.Contains(it.AppliesTo, featureID) {
			words = append(words, it.ID+" "+it.Text)
		}
	}
	return strings.Join(slices.DeleteFunc(words, func(w string) bool { return w == "" }), "\n")
}

// lineWords is a line's ID and words, as the design reads them.
func lineWords(text string) string {
	l := parseLine(text)
	return strings.TrimSpace(l.id + " " + l.text)
}
