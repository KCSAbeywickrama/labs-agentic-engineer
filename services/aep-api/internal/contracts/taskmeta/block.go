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

// Package taskmeta is the pure, IO-free encoding shared by the two halves of
// the Task/Execution split (docs/design/tasks-github-native.md §1, §10):
//
//   - a Task is a GitHub issue, owned entirely by GitHub — its labels, body,
//     open/closed state, and linked PRs. The GitHub-facing feature reads and
//     writes it.
//   - an Execution is one platform attempt at one kind of work for a Task,
//     owned entirely by Postgres. The platform-owned feature manages it.
//
// The two halves never share a package; the encoding they both speak lives
// here and nowhere else. This package therefore holds:
//
//   - the machine block (block.go): the versioned, human-editable document
//     embedded invisibly in the issue body that carries a Task's structured
//     facts (component/operation, dependsOn, origin, lineage, idempotency key);
//   - the label vocabulary (labels.go): marker / class / origin / command /
//     projection labels;
//   - the derived-status algebra (derive.go): (GitHub facts ⋈ executions) →
//     the computed, never-stored Task status;
//   - Execution kinds and statuses (execution.go).
//
// It is arch-locked to import no gorm, no net/http, no repositories, and no
// feature — a domain leaf like internal/contracts itself. Features import it;
// it imports nothing module-internal.
package taskmeta

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// blockVersion is the machine-block schema marker. Bump the suffix (v2, …) only
// on an incompatible field-layout change; the codec keys off the exact token.
const blockVersion = "aep:task/v1"

// Origin records where a Task came from. It is non-routing metadata (§3): an
// incident-born Task needing a code fix is still executor-class coding. It is
// both a machine-block field and an origin label (labels.go).
type Origin string

const (
	OriginSpecPlan Origin = "spec-plan"
	OriginIncident Origin = "incident"
	OriginManual   Origin = "manual"
)

// Valid reports whether o is one of the three known origins.
func (o Origin) Valid() bool {
	switch o {
	case OriginSpecPlan, OriginIncident, OriginManual:
		return true
	}
	return false
}

// Block is the structured, machine-readable facts carried invisibly in a Task's
// issue body. Exactly one of Component (coding tasks) or Operation (ops tasks)
// is set (§2, §11). DependsOn holds component names — never issue numbers (the
// phase-5 lesson). SpecTag/DesignTag are the lineage; DesignTag doubles as the
// idempotency baseline (§2) — since the single-tag build flow both carry the
// spec tag `v<N>` (historic issues hold legacy `v<N>-<M>` design tags and are
// treated as older lineage). Key is the idempotency key (see Key).
type Block struct {
	Component string   // coding tasks; empty for ops
	Operation string   // ops tasks; empty for coding
	DependsOn []string // component names, never issue numbers
	// GateKind classifies a provision Task (dependency-management §3.6):
	// config-collection | resource-provisioning | org-publish. Empty for
	// coding/ops. Component names the dependency (external/platform-resource) or,
	// for org-publish, the provider component being published.
	GateKind  string
	Origin    Origin // spec-plan | incident | manual
	SpecTag   string // lineage
	DesignTag string // lineage; idempotency baseline (replaces batch_id)
	Key       string // idempotency key (see Key)
}

// Provision gate kinds carried in Block.GateKind (dependency-management §3.6).
const (
	// GateConfigCollection: collect an external dependency's config/secret values.
	GateConfigCollection = "config-collection"
	// GateResourceProvisioning: provision a platform-resource (e.g. postgres-cnpg).
	GateResourceProvisioning = "resource-provisioning"
	// GateOrgPublish: publish a provider component org-wide (namespace visibility).
	GateOrgPublish = "org-publish"
	// GateOrgServiceVisibility: the CONSUMER-side hold minted at build for an
	// approved-but-unresolved cross-project org-service dependency. It gates the
	// consumer's coding task until the provider publishes org-wide (issue #164,
	// Task 4). Distinct from GateOrgPublish, which is the PROVIDER-side publish
	// nudge; the two are the mirror halves of one cross-project flow.
	GateOrgServiceVisibility = "org-service-visibility"
)

// Human is the human-editable remainder of a Task issue body: the rationale
// line the planner writes and the free-form markdown scope/body.
type Human struct {
	Rationale string
	Body      string
}

// Typed parse errors so callers (the issues.edited handler, the reconciliation
// sweep) can distinguish "not a machine-managed block" from "block is present
// but corrupt" and react accordingly (repair vs aep:attention flag, §2).
var (
	// ErrNoBlock means the body carries no aep:task machine block at all.
	ErrNoBlock = errors.New("taskmeta: no machine block in body")
	// ErrMangledBlock means a block marker is present but its payload could
	// not be parsed into a usable Block (unrecognized lines, or no
	// component/operation identity).
	ErrMangledBlock = errors.New("taskmeta: machine block is mangled")
)

// blockRE matches the whole machine-block HTML comment and captures its YAML-ish
// payload (group 1). (?s) lets . span newlines; the \b stops "aep:task/v10"
// from matching v1; the non-greedy .*? stops at the first "-->".
var blockRE = regexp.MustCompile(`(?s)<!--[ \t]*` + regexp.QuoteMeta(blockVersion) + `\b(.*?)-->`)

// rationaleRE matches the canonical rationale line and captures the sentence.
var rationaleRE = regexp.MustCompile(`^\s*>\s*\*\*Rationale:\*\*\s?(.*)$`)

// safeScalarRE matches values that serialize without quoting: identifiers,
// slugs, tags, hex keys. Anything else is double-quoted on serialize.
var safeScalarRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`)

// ParseBlock extracts and parses the machine block from a full issue body. It
// is tolerant: the block may appear anywhere in the body, keys may be in any
// order and any case, dependsOn may be flow ([a, b]) or block (- a) style, and
// unrecognized keys are ignored. It returns ErrNoBlock when absent and
// ErrMangledBlock when a marker is present but the payload is unusable.
func ParseBlock(body string) (Block, error) {
	loc := blockRE.FindStringSubmatchIndex(body)
	if loc == nil {
		return Block{}, ErrNoBlock
	}
	return parsePayload(body[loc[2]:loc[3]])
}

// ParseBody parses both halves of an issue body: the machine block and the
// human remainder (rationale + markdown). The Block error mirrors ParseBlock;
// the Human part is always recoverable (it is just text with the block and
// rationale line removed), so it is returned even alongside a block error.
func ParseBody(body string) (Block, Human, error) {
	b, err := ParseBlock(body)
	h := extractHuman(body)
	return b, h, err
}

// Target returns the block's routing target — the component for a coding task
// or the operation for an ops task. Used as the identity dimension in Key.
func (b Block) Target() string {
	if b.Component != "" {
		return b.Component
	}
	return b.Operation
}

// Serialize renders the block into its canonical HTML-comment form. Field order
// is fixed and empty fields are omitted, so the output is deterministic: it is
// the anchor for repair idempotency (§9.2 echo suppression). dependsOn is
// rendered flow-style; scalars are double-quoted only when they contain a
// character outside the safe identifier set.
func (b Block) Serialize() string {
	var sb strings.Builder
	sb.WriteString("<!-- ")
	sb.WriteString(blockVersion)
	sb.WriteByte('\n')
	writeField := func(key, val string) {
		if val != "" {
			sb.WriteString(key)
			sb.WriteString(": ")
			sb.WriteString(scalar(val))
			sb.WriteByte('\n')
		}
	}
	writeField("component", b.Component)
	writeField("operation", b.Operation)
	if len(b.DependsOn) > 0 {
		sb.WriteString("dependsOn: ")
		sb.WriteString(flowList(b.DependsOn))
		sb.WriteByte('\n')
	}
	writeField("gateKind", b.GateKind)
	writeField("origin", string(b.Origin))
	writeField("specTag", b.SpecTag)
	writeField("designTag", b.DesignTag)
	writeField("key", b.Key)
	sb.WriteString("-->")
	return sb.String()
}

// ComposeBody builds a full canonical issue body: the machine block first, then
// the rationale blockquote (when present), then the human markdown (§2). It is
// the inverse of ParseBody on canonical input, which is what makes Repair
// idempotent.
func ComposeBody(b Block, h Human) string {
	var sb strings.Builder
	sb.WriteString(b.Serialize())
	sb.WriteByte('\n')
	if h.Rationale != "" {
		sb.WriteString("> **Rationale:** ")
		sb.WriteString(h.Rationale)
		sb.WriteByte('\n')
	}
	body := strings.TrimSpace(h.Body)
	if body != "" {
		sb.WriteByte('\n')
		sb.WriteString(body)
		sb.WriteByte('\n')
	}
	return sb.String()
}

// Repair re-serializes a body into its canonical form: the block is
// canonicalized and moved to the top, duplicate blocks are collapsed to one,
// and the rationale/markdown are preserved. It returns the repaired body and
// whether it differs from the input. Repair is idempotent — a canonical body in
// yields byte-identical out (changed=false) — so §9.2's "write only when the
// re-serialization differs" rule converges in a single step and never
// ping-pongs. A body with no block returns ErrNoBlock; a mangled block returns
// ErrMangledBlock (the caller cannot safely rewrite fields it could not parse).
//
// Caveat: EVERY aep:task/v1 comment in the body is collapsed into the single
// canonical block (extractHuman strips them all). An example aep:task/v1 block
// embedded verbatim in the human markdown is therefore eaten by repair — this
// is intended (the machine block is exactly one), but can surprise an author who
// pastes a sample block into the scope text.
func Repair(body string) (repaired string, changed bool, err error) {
	b, parseErr := ParseBlock(body)
	if parseErr != nil {
		return body, false, parseErr
	}
	canonical := ComposeBody(b, extractHuman(body))
	return canonical, canonical != body, nil
}

// Key computes a Task's idempotency key: the first 12 hex characters of
// SHA-256 over the newline-joined tuple (project, lineageTag, target,
// titleComponent), where lineageTag is the Task's baseline tag (the spec tag
// `v<N>`; legacy issues used the `v<N>-<M>` design tag) and target is the
// component (coding) or operation (ops).
// titleComponent is TitleSlug(title), but falls back to
// hex(sha256(trimmed title))[:12] when the slug would be empty — an
// all-non-ASCII, emoji, or pure-punctuation title slugifies to "", which would
// otherwise collide every such title to one key (silently dropping distinct
// tasks in the plan-tap dedupe, and diverging from the TS DUPLICATE_TITLE check
// which keys off trim+lowercase). Newline is a safe separator — none of the
// inputs contain one — so the mapping is unambiguous. 48 bits is ample for
// dedup within a single project+designTag, and the short form keeps the block
// readable. The recipe is stable and reproducible so the plan tap can dedupe a
// re-run against issues it created on an earlier run (§6).
func Key(project, lineageTag, target, title string) string {
	titleComponent := TitleSlug(title)
	if titleComponent == "" {
		// Slug empty (non-ASCII/emoji/punctuation-only title) — fall back to a
		// hash of the trimmed title so distinct titles keep distinct keys.
		sum := sha256.Sum256([]byte(strings.TrimSpace(title)))
		titleComponent = hex.EncodeToString(sum[:])[:12]
	}
	sum := sha256.Sum256([]byte(strings.Join(
		[]string{project, lineageTag, target, titleComponent}, "\n")))
	return hex.EncodeToString(sum[:])[:12]
}

// slugNonAlnumRE collapses every run of non-[a-z0-9] into a single hyphen.
var slugNonAlnumRE = regexp.MustCompile(`[^a-z0-9]+`)

// TitleSlug lowercases a title and collapses non-alphanumeric runs to single
// hyphens, trimming leading/trailing hyphens. It is part of the documented Key
// recipe (and safe to reuse for display slugs).
func TitleSlug(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	s = slugNonAlnumRE.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// ---- internals -------------------------------------------------------------

// parsePayload turns the text between the marker and "-->" into a Block. It
// supports flow and block style dependsOn, any key case, and ignores unknown
// keys; a line that is neither blank, a comment, a "key: value" pair, nor a
// list item under dependsOn is treated as corruption (ErrMangledBlock), as is a
// payload with no component/operation identity.
func parsePayload(payload string) (Block, error) {
	var b Block
	inDependsOn := false
	for _, raw := range strings.Split(payload, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if line == "-" || strings.HasPrefix(line, "- ") {
			if !inDependsOn {
				return Block{}, fmt.Errorf("%w: stray list item %q", ErrMangledBlock, line)
			}
			if item := parseScalar(strings.TrimSpace(strings.TrimPrefix(line, "-"))); item != "" {
				b.DependsOn = append(b.DependsOn, item)
			}
			continue
		}
		idx := strings.Index(line, ":")
		if idx < 0 {
			return Block{}, fmt.Errorf("%w: line is not key:value or list item: %q", ErrMangledBlock, line)
		}
		key := strings.ToLower(strings.TrimSpace(line[:idx]))
		val := strings.TrimSpace(line[idx+1:])
		inDependsOn = false
		switch key {
		case "component":
			b.Component = parseScalar(val)
		case "operation":
			b.Operation = parseScalar(val)
		case "gatekind":
			b.GateKind = parseScalar(val)
		case "origin":
			b.Origin = Origin(parseScalar(val))
		case "spectag":
			b.SpecTag = parseScalar(val)
		case "designtag":
			b.DesignTag = parseScalar(val)
		case "key":
			b.Key = parseScalar(val)
		case "dependson":
			if val == "" {
				inDependsOn = true // block-style items follow
			} else {
				b.DependsOn = parseFlowList(val)
			}
		default:
			// Unknown key — tolerate (a forward-compatible or human-added key).
		}
	}
	if b.Component == "" && b.Operation == "" {
		return Block{}, fmt.Errorf("%w: no component or operation", ErrMangledBlock)
	}
	return b, nil
}

// extractHuman returns the human-editable remainder of a body: every machine
// block removed, the first rationale line lifted out, and the rest trimmed.
func extractHuman(body string) Human {
	stripped := blockRE.ReplaceAllString(body, "")
	var h Human
	var kept []string
	for _, ln := range strings.Split(stripped, "\n") {
		if h.Rationale == "" {
			if m := rationaleRE.FindStringSubmatch(ln); m != nil {
				h.Rationale = strings.TrimSpace(m[1])
				continue
			}
		}
		kept = append(kept, ln)
	}
	h.Body = strings.TrimSpace(strings.Join(kept, "\n"))
	return h
}

// parseFlowList parses a flow sequence "[a, b, c]" into trimmed, non-empty
// items. The split is quote-aware, so a quoted item containing a comma
// (e.g. ["a,b", c]) round-trips through Serialize→ParseBlock. A bare scalar (no
// brackets) is treated as a single-item list for tolerance.
func parseFlowList(val string) []string {
	val = strings.TrimSpace(val)
	if strings.HasPrefix(val, "[") && strings.HasSuffix(val, "]") {
		val = val[1 : len(val)-1]
	}
	var out []string
	for _, part := range splitFlowItems(val) {
		if item := parseScalar(strings.TrimSpace(part)); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// splitFlowItems splits a flow-sequence body on top-level commas, ignoring
// commas inside single- or double-quoted scalars (double quotes honor backslash
// escapes) so a quoted comma is not mistaken for a separator.
func splitFlowItems(s string) []string {
	var (
		items []string
		buf   strings.Builder
		quote byte // 0, '"' or '\''
	)
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case quote == '"' && c == '\\' && i+1 < len(s):
			// Keep the escape sequence verbatim; parseScalar unescapes later.
			buf.WriteByte(c)
			buf.WriteByte(s[i+1])
			i++
		case quote != 0:
			buf.WriteByte(c)
			if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
			buf.WriteByte(c)
		case c == ',':
			items = append(items, buf.String())
			buf.Reset()
		default:
			buf.WriteByte(c)
		}
	}
	items = append(items, buf.String())
	return items
}

// flowList renders items as a canonical flow sequence "[a, b, c]".
func flowList(items []string) string {
	parts := make([]string, len(items))
	for i, it := range items {
		parts[i] = scalar(it)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// scalar renders a value, double-quoting (with \ and " escaped) only when it
// falls outside the safe identifier set so canonical output stays clean for
// normal tokens yet round-trips any value.
func scalar(s string) string {
	if s != "" && safeScalarRE.MatchString(s) {
		return s
	}
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	return `"` + r.Replace(s) + `"`
}

// parseScalar strips optional surrounding quotes (double with escapes, single
// literal) and trims whitespace — the inverse of scalar for parsing.
func parseScalar(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if s[0] == '"' && s[len(s)-1] == '"' {
			return strings.NewReplacer(`\"`, `"`, `\\`, `\`).Replace(s[1 : len(s)-1])
		}
		if s[0] == '\'' && s[len(s)-1] == '\'' {
			return s[1 : len(s)-1]
		}
	}
	return s
}
