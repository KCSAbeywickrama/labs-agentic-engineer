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

// The yamlemit byte-parity lock: every case in testdata/yamlemit_golden.json
// (recorded from the REAL npm yaml package via testdata/gen/gen-yamlemit.mjs)
// must emit byte-identically — or, for "UNSUPPORTED-" cases, fail loudly with
// the typed error. The companion parity_node_test regenerates the table live
// against node when available.

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"strconv"
	"strings"
	"testing"
)

type emitCase struct {
	Name string          `json:"name"`
	Doc  json.RawMessage `json:"doc"`
	Want string          `json:"want"`
}

func loadEmitCases(t *testing.T, path string) []emitCase {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var cases []emitCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if len(cases) < 50 {
		t.Fatalf("suspiciously small fixture: %d cases", len(cases))
	}
	return cases
}

// decodeFixtureNode decodes the generator's order-preserving value encoding:
// {"$map": [[k,v],...]}, {"$num": "<ECMA literal>"}, arrays, plain scalars.
func decodeFixtureNode(t *testing.T, raw json.RawMessage) *yNode {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("decode fixture value: %v", err)
	}
	return fixtureNode(t, v)
}

func fixtureNode(t *testing.T, v any) *yNode {
	t.Helper()
	switch tv := v.(type) {
	case nil, bool, string:
		return scalarNode(tv)
	case map[string]any:
		if lit, ok := tv["$num"].(string); ok {
			return scalarNode(parseECMALiteral(t, lit))
		}
		pairsRaw, ok := tv["$map"].([]any)
		if !ok {
			t.Fatalf("bad fixture map: %v", tv)
		}
		out := &yNode{kind: yMap}
		for _, pr := range pairsRaw {
			kv, ok := pr.([]any)
			if !ok || len(kv) != 2 {
				t.Fatalf("bad fixture pair: %v", pr)
			}
			key, ok := kv[0].(string)
			if !ok {
				t.Fatalf("bad fixture key: %v", kv[0])
			}
			out.pairs = append(out.pairs, yPair{key: key, val: fixtureNode(t, kv[1])})
		}
		return out
	case []any:
		out := &yNode{kind: ySeq}
		for _, item := range tv {
			out.items = append(out.items, fixtureNode(t, item))
		}
		return out
	default:
		t.Fatalf("unexpected fixture value type %T", v)
		return nil
	}
}

func parseECMALiteral(t *testing.T, lit string) float64 {
	t.Helper()
	switch lit {
	case "-0":
		return math.Copysign(0, -1)
	case "Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	case "NaN":
		return math.NaN()
	}
	f, err := strconv.ParseFloat(lit, 64)
	if err != nil {
		t.Fatalf("bad $num literal %q: %v", lit, err)
	}
	return f
}

func runEmitCases(t *testing.T, cases []emitCase) {
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			doc := decodeFixtureNode(t, c.Doc)
			got, err := emitDocument(doc)
			if strings.HasPrefix(c.Name, "UNSUPPORTED-") {
				var ue *UnsupportedFrontmatterError
				if !errors.As(err, &ue) {
					t.Fatalf("want UnsupportedFrontmatterError, got err=%v out=%q (npm emits %q)", err, got, c.Want)
				}
				return
			}
			if err != nil {
				t.Fatalf("emit failed: %v (npm emits %q)", err, c.Want)
			}
			if got != c.Want {
				t.Fatalf("byte divergence from npm yaml:\n got: %q\nwant: %q", got, c.Want)
			}
		})
	}
}

func TestYamlEmit_MatchesNpmGolden(t *testing.T) {
	runEmitCases(t, loadEmitCases(t, "testdata/yamlemit_golden.json"))
}

// TestEcmaNumberString pins the ECMA-262 formatting thresholds directly.
func TestEcmaNumberString(t *testing.T) {
	cases := map[float64]string{
		0:                  "0",
		42:                 "42",
		-7:                 "-7",
		1.5:                "1.5",
		1e-7:               "1e-7",
		1e-6:               "0.000001",
		1e-5:               "0.00001",
		1e20:               "100000000000000000000",
		1e21:               "1e+21",
		1e300:              "1e+300",
		0.1:                "0.1",
		1.0 / 3.0:          "0.3333333333333333",
		9007199254740991:   "9007199254740991",
		1234.5678:          "1234.5678",
		2.5e-10:            "2.5e-10",
		123456789012345680: "123456789012345680",
	}
	for in, want := range cases {
		if got := ecmaNumberString(in); got != want {
			t.Errorf("ecmaNumberString(%v) = %q, want %q", in, got, want)
		}
	}
	if got := emitNumber(math.Copysign(0, -1)); got != "-0" {
		t.Errorf("emitNumber(-0) = %q, want -0", got)
	}
	if got := emitNumber(math.Inf(1)); got != ".inf" {
		t.Errorf("emitNumber(+inf) = %q", got)
	}
	if got := emitNumber(math.NaN()); got != ".nan" {
		t.Errorf("emitNumber(nan) = %q", got)
	}
}
