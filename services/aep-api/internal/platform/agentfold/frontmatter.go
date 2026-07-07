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

// frontmatter.go — the setFrontmatterField port (bundle.ts): parse the leading
// `---` fence, mutate the mapping preserving key order, re-emit with the
// yamlemit subset emitter, splice back onto the body.
//
// PARSING: gopkg.in/yaml.v3's Node API supplies structure (key order, scalar
// styles, raw scalar text); plain-scalar RESOLUTION is then done here with npm
// yaml's core-schema rules (extracted from yaml@2.9.0 schema/core), because
// yaml.v3's own resolver diverges (timestamps, 1.1-isms). Duplicate keys and
// multi-document sources are rejected exactly like npm parse (INVALID_YAML).
//
// The reparse GUARD (checkYAMLGuard) is validity-only and uses yaml.v3's
// decoder directly; npm-yaml-vs-yaml.v3 acceptance differences there are a
// documented residual risk that the D14 manifest gate converts into a loud
// turn failure rather than a divergent commit.

import (
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// frontmatterRe is FRONTMATTER_RE: the leading `---\n<block>\n---` fence.
var frontmatterRe = regexp.MustCompile(`^---\n([\s\S]*?)\n---\n?`)

// yamlPathRe: files whose WHOLE content is YAML-guarded on every write.
var yamlPathRe = regexp.MustCompile(`(?i)\.ya?ml$`)

// setFrontmatterField computes the post-op content for one setFrontmatterField
// call on `content` (which the caller verified exists). Returns exactly one of:
//   - next content plus a nil problem — the op applied;
//   - a rejection problem (code + complete message) — the op failed
//     self-correctably and the fold stays byte-unchanged (TS parity);
//   - an error (*UnsupportedFrontmatterError) — the TS fold applied something
//     this port cannot re-emit byte-identically; the turn must fail.
func setFrontmatterField(path, content, key string, value any) (string, *fmProblem, error) {
	loc := frontmatterRe.FindStringSubmatchIndex(content)
	if loc == nil {
		return "", &fmProblem{code: ErrNoFrontmatter, message: path + " has no leading --- frontmatter fence; use editFile instead."}, nil
	}
	block := content[loc[2]:loc[3]]
	body := content[loc[1]:]

	doc, parseErr, err := parseFrontmatterMapping(block)
	if err != nil {
		return "", nil, stampPath(err, path)
	}
	if parseErr != "" {
		return "", &fmProblem{code: ErrInvalidYAML, message: "existing frontmatter is not valid YAML: " + parseErr}, nil
	}

	node, err := frontmatterValueNode(value)
	if err != nil {
		return "", nil, err
	}
	// `fm[key] = value` on a JS plain object: `__proto__` hits the prototype
	// setter and never becomes an own property — the TS op still "applies"
	// (and re-emits, normalizing formatting) but the field is dropped.
	if key != "__proto__" {
		doc.setKey(key, node)
	}

	emitted, err := emitDocument(doc)
	if err != nil {
		return "", nil, stampPath(err, path)
	}
	blockOut := strings.TrimRight(emitted, "\n") // stringifyYaml(fm).replace(/\n+$/, "")
	return "---\n" + blockOut + "\n---\n" + body, nil, nil
}

// stampPath fills the Path of an UnsupportedFrontmatterError raised below the
// point where the path is known.
func stampPath(err error, path string) error {
	var ue *UnsupportedFrontmatterError
	if errors.As(err, &ue) && ue.Path == "" {
		ue.Path = path
	}
	return err
}

// fmProblem is a self-correctable rejection surfaced as an OpErr.
type fmProblem struct {
	code    ErrCode
	message string // appended after the path by the caller
}

// frontmatterValueNode converts a contract value (string|number|boolean|
// string[]) to a document node. Numbers arrive as float64 (JSON).
func frontmatterValueNode(value any) (*yNode, error) {
	switch v := value.(type) {
	case string:
		return scalarNode(v), nil
	case bool:
		return scalarNode(v), nil
	case float64:
		return scalarNode(v), nil
	case int:
		return scalarNode(float64(v)), nil
	case []string:
		items := make([]*yNode, len(v))
		for i, s := range v {
			items[i] = scalarNode(s)
		}
		return &yNode{kind: ySeq, items: items}, nil
	default:
		return nil, fmt.Errorf("agentfold: invalid frontmatter value type %T (contract allows string|number|boolean|string[])", value)
	}
}

// ---- fence parsing -----------------------------------------------------------

// parseFrontmatterMapping parses the fence block into an ordered mapping.
// Mirrors `parseYaml(block)` + the TS `typeof parsed === "object"` demotion:
// a null/scalar document yields an EMPTY mapping (the op then rebuilds the
// fence from scratch — TS-faithful). Returns (doc, parseError, unsupported).
func parseFrontmatterMapping(block string) (*yNode, string, error) {
	dec := yaml.NewDecoder(strings.NewReader(block))
	var root yaml.Node
	if err := dec.Decode(&root); err != nil {
		if errors.Is(err, io.EOF) {
			return &yNode{kind: yMap}, "", nil // empty block → {}
		}
		return nil, err.Error(), nil
	}
	var extra yaml.Node
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		// npm parse throws on multi-document sources.
		return nil, "source contains multiple documents", nil
	}

	node := &root
	if node.Kind == yaml.DocumentNode {
		if len(node.Content) == 0 {
			return &yNode{kind: yMap}, "", nil
		}
		node = node.Content[0]
	}
	converted, perr, err := convertYAMLNode(node)
	if err != nil || perr != "" {
		return nil, perr, err
	}
	switch converted.kind {
	case yMap:
		return converted, "", nil
	case ySeq:
		// TS: `fm` becomes the ARRAY and the set property is silently dropped
		// on re-stringify. Reproducing that data-loss path is not worth it —
		// fail loudly instead (documented deviation; manifest-gated anyway).
		return nil, "", unsupportedf("frontmatter document is a sequence, not a mapping")
	default:
		// Scalar / null document → `fm = {}` (TS parity).
		return &yNode{kind: yMap}, "", nil
	}
}

// convertYAMLNode maps a yaml.v3 node onto the plain-value tree npm parse
// would produce. Returns (node, parseError, unsupported).
func convertYAMLNode(n *yaml.Node) (*yNode, string, error) {
	if n.Style&yaml.TaggedStyle != 0 {
		return nil, "", unsupportedf("explicit YAML tag %q", n.Tag)
	}
	switch n.Kind {
	case yaml.AliasNode:
		// npm parse resolves aliases into plain values; for scalars the
		// anchor/alias identity is lost on re-stringify — same here.
		if n.Alias != nil && n.Alias.Kind == yaml.ScalarNode {
			return convertYAMLNode(n.Alias)
		}
		return nil, "", unsupportedf("alias to a non-scalar node (npm yaml re-emits anchors for shared collections)")
	case yaml.ScalarNode:
		return &yNode{kind: yScalar, scalar: resolveScalar(n)}, "", nil
	case yaml.SequenceNode:
		if n.Anchor != "" {
			return nil, "", unsupportedf("anchored collection")
		}
		out := &yNode{kind: ySeq}
		for _, c := range n.Content {
			cn, perr, err := convertYAMLNode(c)
			if err != nil || perr != "" {
				return nil, perr, err
			}
			out.items = append(out.items, cn)
		}
		return out, "", nil
	case yaml.MappingNode:
		if n.Anchor != "" {
			return nil, "", unsupportedf("anchored collection")
		}
		out := &yNode{kind: yMap}
		seen := map[string]bool{}
		for i := 0; i+1 < len(n.Content); i += 2 {
			kn, vn := n.Content[i], n.Content[i+1]
			if kn.Kind != yaml.ScalarNode {
				return nil, "", unsupportedf("non-scalar mapping key")
			}
			if kn.Style&yaml.TaggedStyle != 0 {
				return nil, "", unsupportedf("explicit YAML tag %q on a key", kn.Tag)
			}
			key := jsKeyString(resolveScalar(kn))
			if seen[key] {
				// npm parse: "Map keys must be unique".
				return nil, fmt.Sprintf("map keys must be unique (%q is repeated)", key), nil
			}
			seen[key] = true
			// Integer-like keys (JS reorder hazard) are rejected by emitPair.
			cv, perr, err := convertYAMLNode(vn)
			if err != nil || perr != "" {
				return nil, perr, err
			}
			out.pairs = append(out.pairs, yPair{key: key, val: cv})
		}
		return out, "", nil
	default:
		return nil, "", unsupportedf("unsupported YAML node kind %d", n.Kind)
	}
}

// resolveScalar applies npm yaml's CORE-schema resolution to one scalar node:
// quoted/block scalars are strings; plain scalars resolve by the core tag
// regexes (null, bool, ints incl. 0o/0x, floats incl. .inf/.nan), else string.
func resolveScalar(n *yaml.Node) any {
	if n.Style != 0 && n.Style != yaml.FlowStyle {
		// single/double-quoted, literal, folded → always a string; yaml.v3
		// has already decoded escapes and chomping into Value.
		return n.Value
	}
	s := n.Value
	switch {
	case coreTagRes[0].MatchString(s): // null (also the empty value)
		return nil
	case coreTagRes[1].MatchString(s): // bool
		return s == "true" || s == "True" || s == "TRUE"
	case coreTagRes[2].MatchString(s): // 0o octal int
		return radixToFloat(s[2:], 8)
	case coreTagRes[3].MatchString(s): // decimal int → JS Number(str)
		f, _ := strconv.ParseFloat(s, 64)
		return f
	case coreTagRes[4].MatchString(s): // 0x hex int
		return radixToFloat(s[2:], 16)
	case coreTagRes[5].MatchString(s): // .inf / .nan
		switch {
		case strings.HasSuffix(strings.ToLower(s), "nan"):
			return math.NaN()
		case strings.HasPrefix(s, "-"):
			return math.Inf(-1)
		default:
			return math.Inf(1)
		}
	case coreTagRes[6].MatchString(s), coreTagRes[7].MatchString(s): // floats
		// ParseFloat's ErrRange values (±Inf, 0) match JS Number over/underflow.
		f, _ := strconv.ParseFloat(s, 64)
		return f
	default:
		return s
	}
}

// radixToFloat is JS parseInt(str, radix) for digits-only input: exact big
// integer, then the IEEE-754 round-to-nearest-even conversion JS applies.
func radixToFloat(digits string, radix int) float64 {
	if v, err := strconv.ParseUint(digits, radix, 64); err == nil {
		return float64(v)
	}
	i, ok := new(big.Int).SetString(digits, radix)
	if !ok {
		return math.NaN()
	}
	f, _ := new(big.Float).SetInt(i).Float64()
	return f
}

// jsKeyString is the JS property-key coercion npm's toJS applies to mapping
// keys: String(value).
func jsKeyString(v any) string {
	switch t := v.(type) {
	case nil:
		return "null"
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		switch {
		case math.IsNaN(t):
			return "NaN"
		case math.IsInf(t, 1):
			return "Infinity"
		case math.IsInf(t, -1):
			return "-Infinity"
		case t == 0:
			return "0" // String(-0) === "0"
		}
		return ecmaNumberString(t)
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

// isJSArrayIndexKey reports whether a JS object would treat the key as an
// array index (canonical numeric string < 2^32-1) and therefore reorder it
// ahead of insertion-ordered keys.
var canonicalUintRe = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)

func isJSArrayIndexKey(key string) bool {
	if !canonicalUintRe.MatchString(key) {
		return false
	}
	v, err := strconv.ParseUint(key, 10, 64)
	return err == nil && v < 1<<32-1
}

// ---- the reparse guard ---------------------------------------------------------

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
