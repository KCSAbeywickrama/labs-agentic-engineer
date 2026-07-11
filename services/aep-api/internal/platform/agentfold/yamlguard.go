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

// yamlguard.go — the YAML reparse guard (bundle.ts checkYaml): after an
// addFile/editFile write, validate the post-edit content so a broken YAML
// document is rejected (INVALID_YAML) instead of committed. It is validity-only
// and uses yaml.v3's decoder directly; npm-yaml-vs-yaml.v3 acceptance
// differences are a documented residual risk that the D14 manifest gate
// converts into a loud turn failure rather than a divergent commit.

import (
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// frontmatterRe is FRONTMATTER_RE: the leading `---\n<block>\n---` fence.
var frontmatterRe = regexp.MustCompile(`^---\n([\s\S]*?)\n---\n?`)

// yamlPathRe: files whose WHOLE content is YAML-guarded on every write.
var yamlPathRe = regexp.MustCompile(`(?i)\.ya?ml$`)

// checkYAMLGuard is checkYaml: parse-only validation of the post-edit content
// (whole document for *.yaml/*.yml, fence block only for frontmatter files).
// Returns "" when there is nothing to check or it parses cleanly, else the
// parse error. Never re-serializes.
func checkYAMLGuard(path, content string) string {
	if yamlPathRe.MatchString(path) {
		return parseOnlyYAML(content)
	}
	if m := frontmatterRe.FindStringSubmatch(content); m != nil {
		return parseOnlyYAML(m[1])
	}
	return ""
}

// parseOnlyYAML validates one YAML source the way npm `parse` accepts it:
// zero or one document (npm throws on multiple), duplicate mapping keys
// rejected. yaml.v3's Node decoding does not police duplicates, so that check
// is walked explicitly.
func parseOnlyYAML(src string) string {
	dec := yaml.NewDecoder(strings.NewReader(src))
	var root yaml.Node
	if err := dec.Decode(&root); err != nil {
		if errors.Is(err, io.EOF) {
			return ""
		}
		return err.Error()
	}
	var extra yaml.Node
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return "source contains multiple documents"
	}
	return dupKeyCheck(&root)
}

func dupKeyCheck(n *yaml.Node) string {
	switch n.Kind {
	case yaml.MappingNode:
		seen := map[string]bool{}
		for i := 0; i+1 < len(n.Content); i += 2 {
			k := n.Content[i]
			if k.Kind == yaml.ScalarNode {
				id := k.Tag + "\x00" + k.Value
				if seen[id] {
					return fmt.Sprintf("map keys must be unique (%q is repeated)", k.Value)
				}
				seen[id] = true
			}
			if msg := dupKeyCheck(n.Content[i]); msg != "" {
				return msg
			}
			if msg := dupKeyCheck(n.Content[i+1]); msg != "" {
				return msg
			}
		}
	case yaml.DocumentNode, yaml.SequenceNode:
		for _, c := range n.Content {
			if msg := dupKeyCheck(c); msg != "" {
				return msg
			}
		}
	}
	return ""
}
