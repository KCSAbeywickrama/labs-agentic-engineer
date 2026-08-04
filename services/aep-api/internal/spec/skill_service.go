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

// Shared value types + pure SKILL.md parsing helpers. The read/write surface
// itself is repo-backed and lives in repo_store.go + reconcile.go (the per-org
// GitHub skills repo is the single source of truth — there is no `skills`
// table). See docs/design/skills-repo-storage.md.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// newSkillValue assembles the in-memory Skill from validated mutation input so
// Create/Update can return the just-written skill WITHOUT a post-commit
// read-back. A read-back through the repo store can transiently return
// (nil, nil) on a GitHub blip (the cache was just evicted by the write), which
// would make the success path hand the controller a nil *Skill and panic.
// Every field here is derivable from what we just committed.
func newSkillValue(orgID, kind, name, skillMD string, refs References, fm skillFrontmatter, enabled bool) *Skill {
	return &Skill{
		OrgID:         orgID,
		Name:          name,
		Kind:          kind,
		Description:   strings.TrimSpace(fm.Description),
		SkillMD:       skillMD,
		References:    map[string]string(refs),
		ContentSHA:    contentSHA(skillMD, refs),
		License:       fm.License,
		Compatibility: fm.Compatibility,
		UpdatedAt:     time.Now().UTC(),
		Enabled:       enabled,
		Audience:      frontmatterAudience(fm),
	}
}

// References is the map of optional reference filenames → body for a skill
// (e.g. `references/examples.md`).
type References map[string]string

// SkillSummary is the lightweight projection used in catalogue listings —
// no body, no references.
type SkillSummary struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
	ContentSHA  string `json:"contentSha"`
	Editable    bool   `json:"editable"`
	Deletable   bool   `json:"deletable"`
	Enabled     bool   `json:"enabled"`
}

// ---- frontmatter parsing ----------------------------------------------------

// skillFrontmatter is the YAML frontmatter shape accepted on SKILL.md.
// Spec-clean AgentSkills: name, description, optional license, compatibility,
// allowed-tools — plus the platform's `metadata.aep` extension carrying the
// skill kind (metadata is the AgentSkills spec's sanctioned extension point).
type skillFrontmatter struct {
	Name          string        `yaml:"name"`
	Description   string        `yaml:"description"`
	License       string        `yaml:"license,omitempty"`
	Compatibility string        `yaml:"compatibility,omitempty"`
	AllowedTools  any           `yaml:"allowed-tools,omitempty"`
	Metadata      skillMetadata `yaml:"metadata,omitempty"`
}

// skillMetadata is the `metadata:` frontmatter map; only the `aep` namespace
// is decoded — other keys stay untouched in the stored bytes.
type skillMetadata struct {
	Aep skillAepMetadata `yaml:"aep,omitempty"`
}

// skillAepMetadata is the platform namespace inside `metadata`. `kind` names
// the skill kind: platform | org | imported. `audience` names the agent(s)
// this skill's guidance is written for: design | coding (ADR-0013); see
// frontmatterAudience for the parse/default rule.
type skillAepMetadata struct {
	Kind     string   `yaml:"kind,omitempty"`
	Audience []string `yaml:"audience,omitempty"`
}

// frontmatterKind derives a skill's kind from its frontmatter: the trimmed
// `metadata.aep.kind` when it names a known kind, else "org" — an unmarked
// SKILL.md is an org skill (platform-shipped or user-authored, page-visible).
// The retired "custom" kind (pre-fold) reads back as org for back-compat with
// already-stored skills; the service stamps org/imported into the files it
// writes going forward, so only the three current values are ever written.
func frontmatterKind(fm skillFrontmatter) string {
	switch k := strings.TrimSpace(fm.Metadata.Aep.Kind); k {
	case SkillKindPlatform, SkillKindOrg, SkillKindImported:
		return k
	case "custom": // retired kind, folded into org (back-compat read)
		return SkillKindOrg
	default:
		return SkillKindOrg
	}
}

// frontmatterAudience derives a skill's audience from its frontmatter:
// `metadata.aep.audience`, filtered to the two recognised values (design,
// coding — unrecognised entries are dropped rather than becoming a third
// audience). An empty or absent list — including one that named only
// unrecognised values — resolves to BOTH: narrowing is opt-in, so an unmarked
// SKILL.md (and any an org authors without knowing the field exists) stays
// readable by whoever asks. Mirrors the TS agents service's
// conversation/load-workspace.ts audience derivation (ADR-0013), which Go
// must agree with byte-for-byte since both read the same stored frontmatter.
func frontmatterAudience(fm skillFrontmatter) []string {
	out := make([]string, 0, len(fm.Metadata.Aep.Audience))
	for _, a := range fm.Metadata.Aep.Audience {
		switch strings.TrimSpace(a) {
		case SkillAudienceDesign, SkillAudienceCoding:
			out = append(out, strings.TrimSpace(a))
		}
	}
	if len(out) == 0 {
		return []string{SkillAudienceDesign, SkillAudienceCoding}
	}
	return out
}

// parseSkillMD splits frontmatter from body and decodes it. Returns the
// decoded frontmatter, the body, and any parse error.
func parseSkillMD(content string) (skillFrontmatter, string, error) {
	fm, body, err := SplitFrontmatter(content)
	if err != nil {
		return skillFrontmatter{}, "", fmt.Errorf("split frontmatter: %w", err)
	}
	if fm == "" {
		return skillFrontmatter{}, "", fmt.Errorf("SKILL.md missing frontmatter")
	}
	var s skillFrontmatter
	if err := yaml.Unmarshal([]byte(fm), &s); err != nil {
		return skillFrontmatter{}, "", fmt.Errorf("decode frontmatter: %w", err)
	}
	if strings.TrimSpace(s.Name) == "" {
		return skillFrontmatter{}, "", fmt.Errorf("frontmatter missing name")
	}
	if strings.TrimSpace(s.Description) == "" {
		return skillFrontmatter{}, "", fmt.Errorf("frontmatter missing description")
	}
	return s, body, nil
}

// stampFrontmatterKind returns skillMD with `metadata.aep.kind: <kind>` set
// in its frontmatter — the flat repo layout has no kind directories, so every
// user-owned file must be self-describing (an unstamped SKILL.md reads back
// as kind org: read-only, and reconcile-purged as "retired"). The body is
// preserved byte-for-byte; sibling frontmatter keys survive the yaml.Node
// round-trip (order and comments kept; scalar quoting may normalize). When
// the exact kind is already stamped the input is returned unchanged, so
// repeated saves are byte-stable.
func stampFrontmatterKind(skillMD, kind string) (string, error) {
	fm, _, err := parseSkillMD(skillMD)
	if err != nil {
		return "", fmt.Errorf("stamp kind: %w", err)
	}
	if strings.TrimSpace(fm.Metadata.Aep.Kind) == kind {
		return skillMD, nil
	}
	raw, body, err := SplitFrontmatter(skillMD)
	if err != nil {
		return "", fmt.Errorf("stamp kind: %w", err)
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return "", fmt.Errorf("stamp kind: decode frontmatter: %w", err)
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return "", fmt.Errorf("stamp kind: frontmatter is not a mapping")
	}
	root := doc.Content[0]
	meta := ensureMappingChild(root, "metadata")
	aep := ensureMappingChild(meta, "aep")
	setMappingScalar(aep, "kind", kind)

	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&doc); err != nil {
		return "", fmt.Errorf("stamp kind: encode frontmatter: %w", err)
	}
	if err := enc.Close(); err != nil {
		return "", fmt.Errorf("stamp kind: encode frontmatter: %w", err)
	}
	// SplitFrontmatter strips the closing fence plus ONE newline; reassembling
	// with "---\n" + body restores the original spacing.
	return "---\n" + buf.String() + "---\n" + body, nil
}

// ensureMappingChild returns the mapping value for `key` in mapping node m,
// creating (or replacing a non-mapping value with) an empty mapping.
func ensureMappingChild(m *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			if m.Content[i+1].Kind != yaml.MappingNode {
				m.Content[i+1] = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			}
			return m.Content[i+1]
		}
	}
	k := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}
	v := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	m.Content = append(m.Content, k, v)
	return v
}

// setMappingScalar sets `key: value` in mapping node m, replacing an existing
// value node or appending the pair.
func setMappingScalar(m *yaml.Node, key, value string) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content[i+1] = &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value}
			return
		}
	}
	m.Content = append(m.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value})
}

// contentSHA computes a deterministic hash over the canonical concat of
// the SKILL.md body + sorted reference filenames + their contents.
func contentSHA(skillMD string, references map[string]string) string {
	h := sha256.New()
	h.Write([]byte(skillMD))
	keys := make([]string, 0, len(references))
	for k := range references {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j-1] > keys[j]; j-- {
			keys[j-1], keys[j] = keys[j], keys[j-1]
		}
	}
	for _, k := range keys {
		h.Write([]byte{'\x00'})
		h.Write([]byte(k))
		h.Write([]byte{'\x00'})
		h.Write([]byte(references[k]))
	}
	return hex.EncodeToString(h.Sum(nil))
}
