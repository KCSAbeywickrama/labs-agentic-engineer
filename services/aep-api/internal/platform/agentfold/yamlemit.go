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

// yamlemit.go — a byte-parity SUBSET port of npm yaml@2.9.0's default
// `stringify` (the exact call `FileBundle.setFrontmatterField` makes in
// packages/agent-stream/src/bundle.ts). The port covers the document shapes
// that occur in spec-file frontmatter: a block mapping of scalar values
// (string | number | boolean | null), string sequences, and nested mappings
// of the same. Length arithmetic (fold thresholds, indentAtStart) is done in
// UTF-16 code units, exactly like the JS original.
//
// Anything OUTSIDE the ported subset fails LOUDLY with
// *UnsupportedFrontmatterError instead of emitting potentially-divergent
// bytes (D14: under auto-commit, silent drift = corrupt commits; a failed
// turn is the safe outcome). The unsupported paths are:
//
//   - the FOLDED block scalar (`>`): chosen by npm yaml when a multi-line
//     string has a line over the fold width; its transformation uses
//     lookahead regexes RE2 cannot express;
//   - a sequence containing non-scalar items (mappings inside lists);
//   - integer-like mapping keys ("0", "17", …): JS objects reorder them
//     ahead of every other key, silently permuting the document;
//   - keys whose emitted form exceeds 1024 code units (npm switches to the
//     explicit `? key` form);
//   - anchors/aliases on collections and explicit tags (npm re-emits
//     anchors; scalar aliases are resolved, matching npm's plain-object
//     round-trip).
//
// Everything else — plain/single/double-quoted scalars with npm's exact
// quoting decision tree, core-schema string quoting ("true", "42", ""),
// flow/quoted line folding at width 80, literal block scalars with chomp and
// indent indicators, ECMA-262 number formatting — is ported 1:1 and locked
// by testdata/yamlemit_golden.json (generated from the real npm package) plus
// an optional live-node parity test.

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

// UnsupportedFrontmatterError is the loud, typed failure for frontmatter
// documents outside the byte-parity subset this package can emit. Phase 4b
// treats it as a turn failure (no commit) — never as a self-correctable
// OpResult, because the TS FileBundle DID apply the op and the two folds have
// diverged.
type UnsupportedFrontmatterError struct {
	Path   string
	Reason string
}

func (e *UnsupportedFrontmatterError) Error() string {
	return fmt.Sprintf("agentfold: unsupported frontmatter in %s: %s (the TS fold applied this op; failing loudly instead of emitting divergent bytes)", e.Path, e.Reason)
}

func unsupportedf(format string, args ...any) error {
	// Path is stamped on by the Fold once it knows it.
	return &UnsupportedFrontmatterError{Reason: fmt.Sprintf(format, args...)}
}

// ---- document model ---------------------------------------------------------

type yKind int

const (
	yScalar yKind = iota
	yMap
	ySeq
)

// yNode mirrors the plain-JS value tree npm yaml's parse returns (and
// stringify consumes): scalars are nil | bool | float64 | string; mappings
// keep source key order (JS object insertion order).
type yNode struct {
	kind   yKind
	scalar any // nil | bool | float64 | string (yScalar only)
	pairs  []yPair
	items  []*yNode
}

type yPair struct {
	key string
	val *yNode
}

func scalarNode(v any) *yNode { return &yNode{kind: yScalar, scalar: v} }

// setKey mirrors `fm[key] = value` on a JS object: replace in place, else
// append. The caller has already rejected integer-like keys (JS would reorder
// those) and handled the `__proto__` no-op.
func (m *yNode) setKey(key string, val *yNode) {
	for i := range m.pairs {
		if m.pairs[i].key == key {
			m.pairs[i].val = val
			return
		}
	}
	m.pairs = append(m.pairs, yPair{key: key, val: val})
}

// ---- regexes ported from yaml@2.9.0 -----------------------------------------

var (
	// stringifyString: control chars force double quotes (code points, not bytes).
	forceDQRe = regexp.MustCompile(`[\x{00}-\x{08}\x{0b}-\x{1f}\x{7f}-\x{9f}]`)
	// plainString: values that may not be emitted as plain scalars.
	forbiddenPlainRe = regexp.MustCompile("^[\n\t ,\\[\\]{}#&*!|>'\"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$")
	// containsDocumentMarker.
	docMarkerRe = regexp.MustCompile(`(?m)^(%|---|\.\.\.)`)
	// blockString: a block scalar can't end in whitespace unless the last line is non-empty.
	nlThenWsEndRe = regexp.MustCompile(`\n[\t ]+$`)
	// singleQuotedString: whitespace adjacent to a newline needs double quotes.
	wsAroundNlRe = regexp.MustCompile(`[ \t]\n|\n[ \t]`)

	// The core-schema tag tests (yaml@2.9.0 schema/core): a plain string that
	// LOOKS like one of these must be quoted or it would reparse as that type.
	coreTagRes = []*regexp.Regexp{
		regexp.MustCompile(`^(~|[Nn]ull|NULL)?$`),
		regexp.MustCompile(`^([Tt]rue|TRUE|[Ff]alse|FALSE)$`),
		regexp.MustCompile(`^0o[0-7]+$`),
		regexp.MustCompile(`^[-+]?[0-9]+$`),
		regexp.MustCompile(`^0x[0-9a-fA-F]+$`),
		regexp.MustCompile(`^([-+]?\.(inf|Inf|INF)|\.nan|\.NaN|\.NAN)$`),
		regexp.MustCompile(`^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)[eE][-+]?[0-9]+$`),
		regexp.MustCompile(`^[-+]?(\.[0-9]+|[0-9]+\.[0-9]*)$`),
	}
)

func matchesCoreTag(s string) bool {
	for _, re := range coreTagRes {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}

// ---- emission context --------------------------------------------------------

const (
	lineWidth       = 80
	minContentWidth = 20
	indentStep      = "  "
)

type strCtx struct {
	indent        string
	indentAtStart int // -1 = unset (JS undefined)
	implicitKey   bool
}

// ---- document / collection emission ------------------------------------------

// emitDocument reproduces `stringify(fm)` for a root block mapping, INCLUDING
// the trailing newline (the FileBundle then strips trailing newlines; the
// Fold applies the identical strip).
func emitDocument(root *yNode) (string, error) {
	if root == nil || len(root.pairs) == 0 {
		return "{}\n", nil // empty flow map at the root
	}
	body, err := emitMapBody(root.pairs, "")
	if err != nil {
		return "", err
	}
	return body + "\n", nil
}

// emitMapBody is stringifyBlockCollection for a mapping: one pair per line,
// joined with "\n"+indent (the map's own ctx.indent).
func emitMapBody(pairs []yPair, indent string) (string, error) {
	var b strings.Builder
	for i, p := range pairs {
		line, err := emitPair(p, indent)
		if err != nil {
			return "", err
		}
		if i > 0 {
			b.WriteString("\n")
			b.WriteString(indent)
		}
		b.WriteString(line)
	}
	return b.String(), nil
}

// emitPair is stringifyPair for the shapes in the subset: implicit scalar key,
// then a scalar / sequence / mapping value.
func emitPair(p yPair, indent string) (string, error) {
	if isJSArrayIndexKey(p.key) {
		return "", unsupportedf("integer-like key %q (JS objects reorder array-index keys ahead of every other key, silently permuting the document)", p.key)
	}
	childIndent := indent + indentStep
	keyStr, err := emitString(p.key, strCtx{indent: childIndent, indentAtStart: -1, implicitKey: true})
	if err != nil {
		return "", err
	}
	if u16Len(keyStr) > 1024 {
		return "", unsupportedf("key longer than 1024 characters (npm yaml switches to the explicit `? key` form)")
	}
	str := keyStr + ":"

	v := p.val
	if v == nil {
		v = scalarNode(nil)
	}
	switch v.kind {
	case yScalar:
		valueStr, err := emitScalar(v.scalar, strCtx{indent: childIndent, indentAtStart: u16Len(str) + 1})
		if err != nil {
			return "", err
		}
		ws := " "
		if valueStr == "" || strings.HasPrefix(valueStr, "\n") {
			ws = ""
		}
		return str + ws + valueStr, nil
	case ySeq:
		if len(v.items) == 0 {
			return str + " []", nil
		}
		body, err := emitSeqBody(v.items, childIndent)
		if err != nil {
			return "", err
		}
		return str + "\n" + childIndent + body, nil
	case yMap:
		if len(v.pairs) == 0 {
			return str + " {}", nil
		}
		body, err := emitMapBody(v.pairs, childIndent)
		if err != nil {
			return "", err
		}
		return str + "\n" + childIndent + body, nil
	default:
		return "", unsupportedf("unknown node kind %d", v.kind)
	}
}

// emitSeqBody is stringifyBlockCollection for a sequence of SCALAR items
// ("- item" lines joined with "\n"+indent; items emitted at indent+2).
func emitSeqBody(items []*yNode, indent string) (string, error) {
	itemIndent := indent + indentStep
	var b strings.Builder
	for i, it := range items {
		if it == nil {
			it = scalarNode(nil)
		}
		if it.kind != yScalar {
			return "", unsupportedf("sequence with non-scalar items")
		}
		itemStr, err := emitScalar(it.scalar, strCtx{indent: itemIndent, indentAtStart: -1})
		if err != nil {
			return "", err
		}
		if i > 0 {
			b.WriteString("\n")
			b.WriteString(indent)
		}
		b.WriteString("- ")
		b.WriteString(itemStr)
	}
	return b.String(), nil
}

// ---- scalar emission ----------------------------------------------------------

func emitScalar(v any, ctx strCtx) (string, error) {
	switch t := v.(type) {
	case nil:
		return "null", nil
	case bool:
		if t {
			return "true", nil
		}
		return "false", nil
	case float64:
		return emitNumber(t), nil
	case string:
		return emitString(t, ctx)
	default:
		return "", unsupportedf("unsupported scalar type %T", v)
	}
}

// emitNumber is stringifyNumber (no format/minFractionDigits in our path).
func emitNumber(f float64) string {
	if math.IsNaN(f) {
		return ".nan"
	}
	if math.IsInf(f, 1) {
		return ".inf"
	}
	if math.IsInf(f, -1) {
		return "-.inf"
	}
	if f == 0 && math.Signbit(f) {
		return "-0"
	}
	return ecmaNumberString(f)
}

// emitString is stringifyString for an untyped (freshly-created) string node.
func emitString(value string, ctx strCtx) (string, error) {
	if forceDQRe.MatchString(value) {
		return emitDoubleQuoted(value, ctx), nil
	}
	return emitPlain(value, ctx)
}

// emitPlain is plainString (type undefined, never inFlow).
func emitPlain(value string, ctx strCtx) (string, error) {
	hasNL := strings.Contains(value, "\n")
	if ctx.implicitKey && hasNL {
		return emitQuoted(value, ctx), nil
	}
	if forbiddenPlainRe.MatchString(value) {
		if ctx.implicitKey || !hasNL {
			return emitQuoted(value, ctx), nil
		}
		return emitBlock(value, ctx)
	}
	if hasNL {
		// type is not explicitly PLAIN → prefer block style for multiline.
		return emitBlock(value, ctx)
	}
	if docMarkerRe.MatchString(value) {
		// ctx.indent is never "" here (values sit under a mapping key), so the
		// root-level forceBlockIndent branch is unreachable; the key-at-root
		// case quotes.
		if ctx.implicitKey && ctx.indent == indentStep {
			return emitQuoted(value, ctx), nil
		}
	}
	str := value // single-line: the \n+ indent splice is a no-op
	if matchesCoreTag(str) {
		return emitQuoted(value, ctx), nil
	}
	if ctx.implicitKey {
		return str, nil
	}
	return foldLines(str, ctx.indent, foldFlowMode, ctx.indentAtStart), nil
}

// emitQuoted is quotedString with the default `singleQuote: null` (prefer
// double quotes; single only when the value has `"` and no `'`).
func emitQuoted(value string, ctx strCtx) string {
	hasDouble := strings.Contains(value, `"`)
	hasSingle := strings.Contains(value, "'")
	if hasDouble && !hasSingle {
		return emitSingleQuoted(value, ctx)
	}
	return emitDoubleQuoted(value, ctx)
}

func emitSingleQuoted(value string, ctx strCtx) string {
	if (ctx.implicitKey && strings.Contains(value, "\n")) || wsAroundNlRe.MatchString(value) {
		return emitDoubleQuoted(value, ctx)
	}
	body := strings.ReplaceAll(value, "'", "''")
	body = appendAfterNewlineRuns(body, "\n"+ctx.indent, false)
	res := "'" + body + "'"
	if ctx.implicitKey {
		return res
	}
	return foldLines(res, ctx.indent, foldFlowMode, ctx.indentAtStart)
}

// emitDoubleQuoted is doubleQuotedString: ECMA JSON quoting, then npm yaml's
// escape rewrite (\a \v \e \0 \xNN …), the short-string newline-escape keep,
// the long-string real-newline fold, and FOLD_QUOTED line folding.
func emitDoubleQuoted(value string, ctx strCtx) string {
	const minMultiLineLength = 40
	j := utf16.Encode([]rune(ecmaQuoteJSON(value)))
	ind := ctx.indent
	var str []uint16
	start := 0
	for i := 0; i < len(j); i++ {
		ch := j[i]
		if ch == ' ' && chAt(j, i+1) == '\\' && chAt(j, i+2) == 'n' {
			// A space before an escaped newline must itself be escaped so
			// folding can't eat it.
			str = append(str, j[start:i]...)
			str = append(str, '\\', ' ')
			i++
			start = i
			ch = '\\'
		}
		if ch == '\\' {
			switch chAt(j, i+1) {
			case 'u':
				str = append(str, j[start:i]...)
				code := string(utf16.Decode(j[i+2 : i+6])) // \uXXXX is always complete in ECMA JSON output
				switch code {
				case "0000":
					str = append(str, '\\', '0')
				case "0007":
					str = append(str, '\\', 'a')
				case "000b":
					str = append(str, '\\', 'v')
				case "001b":
					str = append(str, '\\', 'e')
				case "0085":
					str = append(str, '\\', 'N')
				case "00a0":
					str = append(str, '\\', '_')
				case "2028":
					str = append(str, '\\', 'L')
				case "2029":
					str = append(str, '\\', 'P')
				default:
					if strings.HasPrefix(code, "00") {
						str = append(str, '\\', 'x', j[i+4], j[i+5])
					} else {
						str = append(str, j[i:i+6]...)
					}
				}
				i += 5
				start = i + 1
			case 'n':
				if ctx.implicitKey || chAt(j, i+2) == '"' || len(j) < minMultiLineLength {
					i++
				} else {
					// Fold the escaped newline into a real one (folding will
					// eat the first newline, hence the doubling).
					str = append(str, j[start:i]...)
					str = append(str, '\n', '\n')
					for chAt(j, i+2) == '\\' && chAt(j, i+3) == 'n' && chAt(j, i+4) != '"' {
						str = append(str, '\n')
						i += 2
					}
					str = append(str, utf16.Encode([]rune(ind))...)
					if chAt(j, i+2) == ' ' {
						str = append(str, '\\')
					}
					i++
					start = i + 1
				}
			default:
				i++
			}
		}
	}
	var out string
	if start > 0 {
		out = string(utf16.Decode(append(str, j[start:]...)))
	} else {
		out = string(utf16.Decode(j))
	}
	if ctx.implicitKey {
		return out
	}
	return foldLines(out, ind, foldQuotedMode, ctx.indentAtStart)
}

// emitBlock is blockString for an untyped node with the default
// `blockQuote: true`. Only the LITERAL branch is ported; the folded branch
// (a line over the fold width) fails loudly — see the file header.
func emitBlock(value string, ctx strCtx) (string, error) {
	if nlThenWsEndRe.MatchString(value) {
		// Block scalars can't end in whitespace unless the last line is non-empty.
		return emitQuoted(value, ctx), nil
	}
	indent := ctx.indent
	if lineLengthOverLimit(value, lineWidth, u16Len(indent)) {
		return "", unsupportedf("multi-line string with a line over the fold width would emit as a folded (>) block scalar")
	}
	if value == "" {
		return "|\n", nil
	}

	// Chomp indicator from the trailing whitespace. All scanned chars are
	// ASCII, so rune indices equal byte indices within the affected slices.
	r := []rune(value)
	endStart := len(r)
	for ; endStart > 0; endStart-- {
		ch := r[endStart-1]
		if ch != '\n' && ch != '\t' && ch != ' ' {
			break
		}
	}
	end := string(r[endStart:])
	endNlPos := strings.Index(end, "\n")
	var chomp string
	switch {
	case endNlPos == -1:
		chomp = "-" // strip
	case value == end || endNlPos != len(end)-1:
		chomp = "+" // keep
	default:
		chomp = "" // clip
	}
	if end != "" {
		value = value[:len(value)-len(end)]
		if strings.HasSuffix(end, "\n") {
			end = end[:len(end)-1]
		}
		end = appendAfterNewlineRuns(end, indent, true)
	}

	// Indent indicator from the leading whitespace.
	startWithSpace := false
	rv := []rune(value)
	startEnd := 0
	startNlPos := -1
	for ; startEnd < len(rv); startEnd++ {
		switch rv[startEnd] {
		case ' ':
			startWithSpace = true
		case '\n':
			startNlPos = startEnd
		default:
			goto scanned
		}
	}
scanned:
	cut := startEnd
	if startNlPos < startEnd {
		cut = startNlPos + 1
	}
	start := string(rv[:cut])
	if start != "" {
		value = string(rv[cut:])
		start = appendAfterNewlineRuns(start, indent, false)
	}

	header := chomp
	if startWithSpace {
		header = "2" + chomp // indent is never "" here → indicator "2"
	}
	value = appendAfterNewlineRuns(value, indent, false)
	return "|" + header + "\n" + indent + start + value + end, nil
}

// appendAfterNewlineRuns inserts `suffix` after every maximal run of '\n'.
// With skipTrailing (the blockEndNewlines regex) a run that ends the string
// is left alone.
func appendAfterNewlineRuns(s, suffix string, skipTrailing bool) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if s[i] != '\n' {
			b.WriteByte(s[i])
			i++
			continue
		}
		j := i
		for j < len(s) && s[j] == '\n' {
			j++
		}
		b.WriteString(s[i:j])
		if !skipTrailing || j < len(s) {
			b.WriteString(suffix)
		}
		i = j
	}
	return b.String()
}

// ---- foldFlowLines ------------------------------------------------------------

type foldMode int

const (
	foldFlowMode foldMode = iota
	foldQuotedMode
)

func chAt(t []uint16, i int) uint16 {
	if i < 0 || i >= len(t) {
		return 0
	}
	return t[i]
}

// foldLines is foldFlowLines (modes 'flow' and 'quoted'; the fold-block mode
// only serves the unported folded block scalar). indentAtStart < 0 means the
// JS undefined. All arithmetic is in UTF-16 code units.
func foldLines(text, indent string, mode foldMode, indentAtStart int) string {
	t := utf16.Encode([]rune(text))
	ind := utf16.Encode([]rune(indent))

	endStep := 1 + lineWidth - len(ind)
	if m := 1 + minContentWidth; m > endStep {
		endStep = m
	}
	if len(t) <= endStep {
		return text
	}
	var folds []int
	escapedFolds := map[int]bool{}
	end := lineWidth - len(ind)
	if indentAtStart >= 0 {
		mcw := minContentWidth
		if mcw < 2 {
			mcw = 2
		}
		if indentAtStart > lineWidth-mcw {
			folds = append(folds, 0)
		} else {
			end = lineWidth - indentAtStart
		}
	}
	split := -1
	var prev uint16
	escStart, escEnd := -1, -1
	for i := 0; i < len(t); i++ {
		ch := t[i]
		if mode == foldQuotedMode && ch == '\\' {
			escStart = i
			switch chAt(t, i+1) {
			case 'x':
				i += 3
			case 'u':
				i += 5
			case 'U':
				i += 9
			default:
				i++
			}
			escEnd = i
		}
		if ch == '\n' {
			end = i + len(ind) + endStep
			split = -1
		} else {
			if ch == ' ' && prev != 0 && prev != ' ' && prev != '\n' && prev != '\t' {
				next := chAt(t, i+1)
				if next != 0 && next != ' ' && next != '\n' && next != '\t' {
					split = i
				}
			}
			if i >= end {
				if split > 0 { // JS truthiness: a split at 0 never fires
					folds = append(folds, split)
					end = split + endStep
					split = -1
				} else if mode == foldQuotedMode {
					// Whitespace collected at the end may stretch past lineWidth.
					for prev == ' ' || prev == '\t' {
						prev = ch
						i++
						ch = chAt(t, i)
					}
					// Account for the newline escape without breaking a preceding escape.
					j := escStart - 1
					if i > escEnd+1 {
						j = i - 2
					}
					if escapedFolds[j] {
						return text
					}
					folds = append(folds, j)
					escapedFolds[j] = true
					end = j + endStep
					split = -1
				}
				// flow mode: overflow, no split available — leave the line long.
			}
		}
		prev = ch
	}
	if len(folds) == 0 {
		return text
	}
	res := append([]uint16{}, t[:folds[0]]...)
	for k, fold := range folds {
		endI := len(t)
		if k+1 < len(folds) {
			endI = folds[k+1]
		}
		if fold == 0 {
			res = res[:0]
			res = append(res, '\n')
			res = append(res, ind...)
			res = append(res, t[:endI]...)
		} else {
			if mode == foldQuotedMode && escapedFolds[fold] {
				res = append(res, t[fold], '\\')
			}
			res = append(res, '\n')
			res = append(res, ind...)
			res = append(res, t[fold+1:endI]...)
		}
	}
	return string(utf16.Decode(res))
}

// lineLengthOverLimit reports whether any line of str exceeds
// lineWidth - indentLength (UTF-16 units) — the literal-vs-folded choice.
func lineLengthOverLimit(str string, width, indentLength int) bool {
	limit := width - indentLength
	t := utf16.Encode([]rune(str))
	if len(t) <= limit {
		return false
	}
	start := 0
	for i := 0; i < len(t); i++ {
		if t[i] == '\n' {
			if i-start > limit {
				return true
			}
			start = i + 1
			if len(t)-start <= limit {
				return false
			}
		}
	}
	return true
}

// ---- ECMA-262 helpers -----------------------------------------------------------

// ecmaQuoteJSON is ECMA-262 QuoteJSONString (what JSON.stringify does to a
// string): short escapes for \b \t \n \f \r \" \\, \u00xx (lowercase hex) for
// other control chars below 0x20, everything else — including DEL/C1 and
// U+2028/U+2029 — passes through raw.
func ecmaQuoteJSON(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 2)
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// ecmaNumberString is the ECMA-262 Number::toString(10) algorithm over the
// shortest round-trip decimal representation (what JSON.stringify emits for a
// finite, non-negative-zero number).
func ecmaNumberString(f float64) string {
	if f == 0 {
		return "0"
	}
	neg := f < 0
	if neg {
		f = -f
	}
	// Shortest representation in exponent form: "d.dddde±XX".
	e := strconv.FormatFloat(f, 'e', -1, 64)
	mant, expStr, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	exp, _ := strconv.Atoi(expStr)
	k := len(digits)
	n := exp + 1 // value = digits × 10^(n-k)

	var s string
	switch {
	case k <= n && n <= 21:
		s = digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		s = digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		s = "0." + strings.Repeat("0", -n) + digits
	default:
		mag := n - 1
		sign := "+"
		if mag < 0 {
			sign = "-"
			mag = -mag
		}
		if k == 1 {
			s = digits + "e" + sign + strconv.Itoa(mag)
		} else {
			s = digits[:1] + "." + digits[1:] + "e" + sign + strconv.Itoa(mag)
		}
	}
	if neg {
		return "-" + s
	}
	return s
}

// u16Len is the UTF-16 code-unit length (JS String.prototype.length).
func u16Len(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xFFFF {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// jsTrim is String.prototype.trim: ECMA WhiteSpace (TAB VT FF SP NBSP ZWNBSP
// + Unicode Zs) plus LineTerminator (LF CR LS PS). Notably NEL (U+0085) is
// NOT trimmed, unlike Go's unicode.IsSpace.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\v', '\f', ' ', 0x00a0, 0xfeff, '\n', '\r', 0x2028, 0x2029:
			return true
		}
		return r == 0x1680 || (r >= 0x2000 && r <= 0x200a) || r == 0x202f || r == 0x205f || r == 0x3000
	})
}
