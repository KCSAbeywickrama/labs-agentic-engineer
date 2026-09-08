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

import (
	"encoding/json"
	"strings"
	"testing"
)

const depPath = "specs/design/dependencies/payment-provider/dependency.json"
const sdkPath = "specs/design/dependencies/payment-provider/sdk.json"

// dep builds a resolved REST dependency.json for dir "payment-provider" with
// overrides spliced in (a nil value deletes the key) — the same fixture shape
// the zod gate's dependency-design-gate.test.ts uses, so the two tables read
// alike.
func dep(overrides map[string]any) string {
	m := map[string]any{
		"name":        "payment-provider",
		"description": "Charges the customer for shipping.",
		"provider":    "Stripe",
		"style":       "rest-api",
		"contract":    "openapi.yaml",
		"config":      []any{map[string]any{"key": "PAYMENT_API_KEY", "secret": true}},
	}
	for k, v := range overrides {
		if v == nil {
			delete(m, k)
		} else {
			m[k] = v
		}
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func str(s string) *string { return &s }

// TestDependencyGate_Parity locks fold-parity with checkDependencyDesign: every
// case here has its twin in packages/agent-stream/test/dependency-design-gate.test.ts.
func TestDependencyGate_Parity(t *testing.T) {
	two := []any{map[string]any{"name": "a", "style": "sdk"}, map[string]any{"name": "b", "style": "sdk"}}
	cases := []struct {
		name    string
		content string
		prior   *string
		wantOK  bool
		wantMsg string
	}{
		{"resolved rest dependency", dep(nil), nil, true, ""},
		{"open candidates, nothing chosen", dep(map[string]any{"provider": nil, "style": nil, "contract": nil, "candidates": two}), nil, true, ""},
		{"registered-org stub", `{"name":"payment-provider","source":"org"}`, nil, true, ""},
		{"provider chosen, no contract yet", dep(map[string]any{"contract": nil}), nil, true, ""},
		{"name not the directory", dep(map[string]any{"name": "stripe"}), nil, false, `"payment-provider"`},
		{"read-time status rejected", dep(map[string]any{"status": "resolved"}), nil, false, "unknown property status"},
		{"retired specPath rejected", dep(map[string]any{"specPath": "https://x"}), nil, false, "unknown property specPath"},
		{"single candidate", dep(map[string]any{"provider": nil, "style": nil, "contract": nil, "candidates": []any{map[string]any{"name": "a", "style": "sdk"}}}), nil, false, "2 or more"},
		{"candidates with a provider", dep(map[string]any{"candidates": two}), nil, false, "never coexist"},
		{"candidates with a style", dep(map[string]any{"provider": nil, "contract": nil, "candidates": two}), nil, false, "stay unset"},
		{"contract not fitting the style", dep(map[string]any{"contract": "schema.graphql"}), nil, false, `for style "rest-api"`},
		{"graphql contract", dep(map[string]any{"style": "graphql", "contract": "schema.graphql"}), nil, true, ""},
		{"contract as a path", dep(map[string]any{"contract": "specs/x/openapi.yaml"}), nil, false, "not a path"},
		{"contract without a style", dep(map[string]any{"style": nil}), nil, false, `"style" is required`},
		{"sdk with manifest and slice", dep(map[string]any{"style": "sdk", "sdk": "sdk.json"}), nil, true, ""},
		{"sdk with manifest only", dep(map[string]any{"style": "sdk", "sdk": "sdk.json", "contract": nil}), nil, true, ""},
		{"sdk without manifest", dep(map[string]any{"style": "sdk", "contract": nil}), nil, false, "sdk.json"},
		{"sdk on a rest style", dep(map[string]any{"sdk": "sdk.json"}), nil, false, `only meaningful on style "sdk"`},
		{"sdk manifest misnamed", dep(map[string]any{"style": "sdk", "sdk": "manifest.json"}), nil, false, `"sdk.json"`},
		{"secret key with a default", dep(map[string]any{"config": []any{map[string]any{"key": "K", "secret": true, "defaultValue": "x"}}}), nil, false, "secret"},
		{"bad sha256", dep(map[string]any{"provenance": map[string]any{"sha256": "nope"}}), nil, false, "sha256"},
		{"good provenance", dep(map[string]any{"provenance": map[string]any{"sourceUrl": "https://x", "sha256": strings.Repeat("ab", 32), "sliced": true}}), nil, true, ""},
		// Types the zod schema pins — the fold must refuse the same shapes.
		{"secret not a boolean", dep(map[string]any{"config": []any{map[string]any{"key": "K", "secret": "yes"}}}), nil, false, "secret: must be a boolean"},
		{"defaultValue not a string", dep(map[string]any{"config": []any{map[string]any{"key": "K", "defaultValue": 5}}}), nil, false, "defaultValue: must be a string"},
		{"candidate package not a string", dep(map[string]any{"provider": nil, "style": nil, "contract": nil, "candidates": []any{map[string]any{"name": "a", "style": "sdk", "package": 1}, map[string]any{"name": "b", "style": "sdk"}}}), nil, false, "package: must be a string"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := validateDependencyDesign(c.content, "payment-provider", c.prior)
			if c.wantOK && p != nil {
				t.Fatalf("want accepted, got rejected: %s", p.message)
			}
			if !c.wantOK {
				if p == nil {
					t.Fatalf("want rejected, got accepted")
				}
				if !strings.Contains(p.message, c.wantMsg) {
					t.Fatalf("message %q does not contain %q", p.message, c.wantMsg)
				}
			}
		})
	}
}

// The assumption record is the user's; the agent may echo it, never author it.
func TestDependencyGate_AssumptionEchoedNeverAuthored(t *testing.T) {
	assumed := map[string]any{"by": "admin", "at": "2026-09-08T10:15:00Z", "note": "auth guessed"}
	withAssumed := dep(map[string]any{"assumed": assumed})

	if p := validateDependencyDesign(withAssumed, "payment-provider", nil); p == nil || !strings.Contains(p.message, "permission record") {
		t.Fatalf("introducing the record on a create must be refused, got %v", p)
	}
	if p := validateDependencyDesign(withAssumed, "payment-provider", str(`{}`)); p == nil {
		t.Fatalf("introducing the record where the file has none must be refused")
	}
	edited := dep(map[string]any{"assumed": assumed, "description": "edited"})
	if p := validateDependencyDesign(edited, "payment-provider", str(withAssumed)); p != nil {
		t.Fatalf("echoing the record must pass, got %s", p.message)
	}
	altered := dep(map[string]any{"assumed": map[string]any{"by": "agent", "at": "2026-09-08T10:15:00Z", "note": "auth guessed"}})
	if p := validateDependencyDesign(altered, "payment-provider", str(withAssumed)); p == nil {
		t.Fatalf("altering the record must be refused")
	}
	if p := validateDependencyDesign(dep(nil), "payment-provider", str(withAssumed)); p != nil {
		t.Fatalf("dropping the record (a real contract replaced it) must pass, got %s", p.message)
	}
}

func TestDependencyGate_SdkManifest(t *testing.T) {
	ok := `{"packages":{"typescript":"npm:stripe@^14","go":"go:github.com/stripe/stripe-go/v79"},"calls":["paymentIntents.create"]}`
	if p := validateSdkManifest(ok); p != nil {
		t.Fatalf("want accepted, got %s", p.message)
	}
	for name, c := range map[string]struct{ content, want string }{
		"empty packages":  {`{"packages":{}}`, "at least one"},
		"upper-case lang": {`{"packages":{"TypeScript":"npm:stripe"}}`, "lower-case"},
		"no ecosystem":    {`{"packages":{"go":"stripe-go"}}`, "ecosystem-prefixed"},
		"unknown key":     {`{"packages":{"go":"go:x"},"version":"1"}`, "unknown property version"},
		"docsUrl type":    {`{"packages":{"go":"go:x"},"docsUrl":3}`, "docsUrl: must be a string"},
		"assumed type":    {`{"packages":{"go":"go:x"},"assumed":"yes"}`, "assumed: must be a boolean"},
	} {
		t.Run(name, func(t *testing.T) {
			p := validateSdkManifest(c.content)
			if p == nil || !strings.Contains(p.message, c.want) {
				t.Fatalf("want rejection containing %q, got %v", c.want, p)
			}
		})
	}
	if code, _ := checkDependencyDesignGuard(sdkPath, "{nope", nil); code != ErrInvalidJSON {
		t.Fatalf("invalid JSON must be ErrInvalidJSON, got %q", code)
	}
	if code, _ := checkDependencyDesignGuard(depPath, dep(nil), nil); code != "" {
		t.Fatalf("a valid dependency.json must fold, got %q", code)
	}
	if code, _ := checkDependencyDesignGuard("specs/design/dependencies/payment-provider/openapi.yaml", "openapi: 3", nil); code != "" {
		t.Fatalf("a contract file is not this gate's, got %q", code)
	}
}
