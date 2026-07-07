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

package taskmeta

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func sampleBlock() Block {
	return Block{
		Component: "order-service",
		DependsOn: []string{"user-service", "catalog"},
		Origin:    OriginSpecPlan,
		SpecTag:   "requirements-v3",
		DesignTag: "design-v5",
		Key:       "7f3ac2b19e4d",
	}
}

// TestSerializeCanonicalBytes pins the exact canonical serialization — the
// anchor for repair idempotency and the report's byte example.
func TestSerializeCanonicalBytes(t *testing.T) {
	got := sampleBlock().Serialize()
	want := "<!-- aep:task/v1\n" +
		"component: order-service\n" +
		"dependsOn: [user-service, catalog]\n" +
		"origin: spec-plan\n" +
		"specTag: requirements-v3\n" +
		"designTag: design-v5\n" +
		"key: 7f3ac2b19e4d\n" +
		"-->"
	if got != want {
		t.Fatalf("canonical serialization drift:\n got: %q\nwant: %q", got, want)
	}
}

// TestSerializeOmitsEmptyAndRendersOps checks empty fields are omitted and an
// ops block carries operation instead of component.
func TestSerializeOmitsEmptyAndRendersOps(t *testing.T) {
	b := Block{Operation: "provision-idp", Origin: OriginIncident}
	got := b.Serialize()
	want := "<!-- aep:task/v1\noperation: provision-idp\norigin: incident\n-->"
	if got != want {
		t.Fatalf("ops serialize:\n got: %q\nwant: %q", got, want)
	}
	if strings.Contains(got, "component") || strings.Contains(got, "dependsOn") {
		t.Fatalf("empty fields should be omitted: %q", got)
	}
}

func TestParseBlockRoundTrip(t *testing.T) {
	b := sampleBlock()
	body := ComposeBody(b, Human{Rationale: "keeps orders consistent", Body: "## Scope\ndo the thing"})
	got, err := ParseBlock(body)
	if err != nil {
		t.Fatalf("ParseBlock: %v", err)
	}
	if !reflect.DeepEqual(got, b) {
		t.Fatalf("round-trip mismatch:\n got: %+v\nwant: %+v", got, b)
	}
}

// TestParseBlockTolerant covers the human-edit shapes the parser must accept:
// block anywhere in the body, key case/whitespace variance, block-style and
// bare-scalar dependsOn, quoted scalars, unknown keys, and YAML comments.
func TestParseBlockTolerant(t *testing.T) {
	tests := []struct {
		name string
		body string
		want Block
	}{
		{
			name: "block after prose",
			body: "Some human note above.\n\n<!-- aep:task/v1\ncomponent: svc\norigin: manual\n-->",
			want: Block{Component: "svc", Origin: OriginManual},
		},
		{
			name: "key case and extra spaces",
			body: "<!--   aep:task/v1\n  Component :  svc \n  DESIGNTAG: d1 \n-->",
			want: Block{Component: "svc", DesignTag: "d1"},
		},
		{
			name: "block-style dependsOn",
			body: "<!-- aep:task/v1\ncomponent: svc\ndependsOn:\n  - a\n  - b\n-->",
			want: Block{Component: "svc", DependsOn: []string{"a", "b"}},
		},
		{
			name: "bare scalar dependsOn tolerated as single item",
			body: "<!-- aep:task/v1\ncomponent: svc\ndependsOn: solo\n-->",
			want: Block{Component: "svc", DependsOn: []string{"solo"}},
		},
		{
			name: "quoted scalar and unknown key ignored",
			body: "<!-- aep:task/v1\ncomponent: \"weird: value\"\nfuture: whatever\norigin: manual\n-->",
			want: Block{Component: "weird: value", Origin: OriginManual},
		},
		{
			name: "yaml comment line skipped",
			body: "<!-- aep:task/v1\n# a comment\ncomponent: svc\n-->",
			want: Block{Component: "svc"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseBlock(tt.body)
			if err != nil {
				t.Fatalf("ParseBlock: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v want %+v", got, tt.want)
			}
		})
	}
}

// TestParseBlockErrors covers the two typed error paths.
func TestParseBlockErrors(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantErr error
	}{
		{"no block", "just a plain issue body", ErrNoBlock},
		{"v10 does not match v1", "<!-- aep:task/v10\ncomponent: x\n-->", ErrNoBlock},
		{"no identity", "<!-- aep:task/v1\norigin: manual\n-->", ErrMangledBlock},
		{"stray list item", "<!-- aep:task/v1\ncomponent: svc\n- orphan\n-->", ErrMangledBlock},
		{"non kv line", "<!-- aep:task/v1\ncomponent: svc\ngarbage line\n-->", ErrMangledBlock},
		{"empty payload", "<!-- aep:task/v1\n-->", ErrMangledBlock},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseBlock(tt.body)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("got err %v; want %v", err, tt.wantErr)
			}
		})
	}
}

// TestRepairIdempotent is the load-bearing property for §9.2 echo suppression:
// a canonical body repairs to itself (changed=false), and repairing any body
// twice is a fixed point.
func TestRepairIdempotent(t *testing.T) {
	canonical := ComposeBody(sampleBlock(), Human{Rationale: "why", Body: "## Scope\nbody text"})

	repaired, changed, err := Repair(canonical)
	if err != nil {
		t.Fatalf("Repair(canonical): %v", err)
	}
	if changed {
		t.Fatalf("canonical body reported changed; repair is not idempotent:\n%q", repaired)
	}
	if repaired != canonical {
		t.Fatalf("canonical body altered by repair:\n got: %q\nwant: %q", repaired, canonical)
	}
}

// TestRepairNormalizes proves repair fixes messy human formatting: reordered
// keys, a block placed after prose, and a duplicate block all converge to one
// canonical body, and a second repair is a no-op.
func TestRepairNormalizes(t *testing.T) {
	messy := "Human wrote this first.\n\n" +
		"<!-- aep:task/v1\n" +
		"designTag: design-v5\n" + // out of canonical order
		"component: order-service\n" +
		"origin: spec-plan\n" +
		"-->\n" +
		"> **Rationale:** keep it consistent\n\n" +
		"## Scope\nreal work\n\n" +
		"<!-- aep:task/v1\ncomponent: order-service\norigin: spec-plan\n-->" // duplicate

	repaired, changed, err := Repair(messy)
	if err != nil {
		t.Fatalf("Repair: %v", err)
	}
	if !changed {
		t.Fatalf("expected messy body to be reported changed")
	}
	if strings.Count(repaired, "<!-- aep:task/v1") != 1 {
		t.Fatalf("duplicate blocks not collapsed:\n%q", repaired)
	}
	if !strings.HasPrefix(repaired, "<!-- aep:task/v1") {
		t.Fatalf("block not moved to the top:\n%q", repaired)
	}
	if !strings.Contains(repaired, "> **Rationale:** keep it consistent") {
		t.Fatalf("rationale lost:\n%q", repaired)
	}
	if !strings.Contains(repaired, "## Scope\nreal work") {
		t.Fatalf("human body lost:\n%q", repaired)
	}

	// Second repair is a fixed point.
	again, changed2, err := Repair(repaired)
	if err != nil {
		t.Fatalf("Repair(repaired): %v", err)
	}
	if changed2 || again != repaired {
		t.Fatalf("repair not idempotent on already-repaired body")
	}
}

func TestRepairPropagatesParseErrors(t *testing.T) {
	if _, _, err := Repair("no block here"); !errors.Is(err, ErrNoBlock) {
		t.Fatalf("Repair(no block) err=%v; want ErrNoBlock", err)
	}
	if _, _, err := Repair("<!-- aep:task/v1\norigin: manual\n-->"); !errors.Is(err, ErrMangledBlock) {
		t.Fatalf("Repair(mangled) err=%v; want ErrMangledBlock", err)
	}
}

func TestParseBody(t *testing.T) {
	b := sampleBlock()
	body := ComposeBody(b, Human{Rationale: "one sentence", Body: "## Scope\nline1\nline2"})
	gotB, gotH, err := ParseBody(body)
	if err != nil {
		t.Fatalf("ParseBody: %v", err)
	}
	if !reflect.DeepEqual(gotB, b) {
		t.Fatalf("block mismatch: %+v want %+v", gotB, b)
	}
	if gotH.Rationale != "one sentence" {
		t.Fatalf("rationale: %q", gotH.Rationale)
	}
	if gotH.Body != "## Scope\nline1\nline2" {
		t.Fatalf("body: %q", gotH.Body)
	}
}

// TestComposeBodyOmitsEmptyHumanParts confirms an empty rationale/body drop out
// of the composed body cleanly (no dangling markers or blank lines).
func TestComposeBodyOmitsEmptyHumanParts(t *testing.T) {
	got := ComposeBody(Block{Component: "svc", Origin: OriginManual}, Human{})
	want := "<!-- aep:task/v1\ncomponent: svc\norigin: manual\n-->\n"
	if got != want {
		t.Fatalf("compose with empty human:\n got: %q\nwant: %q", got, want)
	}
}

func TestTitleSlug(t *testing.T) {
	tests := map[string]string{
		"Implement order-service": "implement-order-service",
		"  Trim & collapse!! ":    "trim-collapse",
		"UPPER_snake.Case":        "upper-snake-case",
		"---leading/trailing---":  "leading-trailing",
		"café déjà 42":            "caf-d-j-42",
	}
	for in, want := range tests {
		if got := TitleSlug(in); got != want {
			t.Errorf("TitleSlug(%q) = %q; want %q", in, got, want)
		}
	}
}

// TestKeyRecipe pins the idempotency-key recipe: stable, 12 hex chars, and
// sensitive to each input dimension.
func TestKeyRecipe(t *testing.T) {
	k := Key("proj", "design-v5", "order-service", "Implement order-service")
	if len(k) != 12 {
		t.Fatalf("key length = %d; want 12 (%q)", len(k), k)
	}
	for _, c := range k {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Fatalf("key %q is not lowercase hex", k)
		}
	}
	// Deterministic.
	if Key("proj", "design-v5", "order-service", "Implement order-service") != k {
		t.Fatalf("key is not deterministic")
	}
	// Two titles that slugify identically collide (by design: the slug, not the
	// raw title, is the identity dimension — case and punctuation are absorbed).
	if Key("proj", "design-v5", "order-service", "implement ORDER service") != k {
		t.Fatalf("same-slug titles should produce the same key")
	}
	// Each dimension changes the key.
	base := Key("p", "d", "t", "title")
	for _, other := range []string{
		Key("P", "d", "t", "title"),
		Key("p", "D", "t", "title"),
		Key("p", "d", "T", "title"),
		Key("p", "d", "t", "other"),
	} {
		if other == base {
			t.Fatalf("key insensitive to an input dimension")
		}
	}
}

// TestKeyEmptySlugFallback covers the guard: titles that slugify to "" (all
// non-ASCII/emoji/punctuation) must still produce distinct keys, or the
// plan-tap dedupe would silently drop distinct tasks.
func TestKeyEmptySlugFallback(t *testing.T) {
	// Two distinct Japanese titles both slugify to "".
	jaOrders := "注文サービスを実装する"
	jaCatalog := "カタログサービスを実装する"
	if TitleSlug(jaOrders) != "" || TitleSlug(jaCatalog) != "" {
		t.Skip("slug no longer empty for these inputs; test premise stale")
	}
	k1 := Key("proj", "design-v5", "order-service", jaOrders)
	k2 := Key("proj", "design-v5", "order-service", jaCatalog)
	if k1 == k2 {
		t.Fatalf("distinct empty-slug titles collided to one key: %q", k1)
	}
	// Emoji-only titles likewise stay distinct.
	if Key("p", "d", "t", "🚀") == Key("p", "d", "t", "🔥") {
		t.Fatalf("distinct emoji titles collided")
	}
	// The fallback is still deterministic.
	if Key("proj", "design-v5", "order-service", jaOrders) != k1 {
		t.Fatalf("empty-slug fallback is not deterministic")
	}
}

// TestFlowListQuotedCommaRoundTrip is the parse(serialize(b))==b property for a
// dependsOn item that itself contains a comma (so it must serialize quoted and
// parse quote-aware).
func TestFlowListQuotedCommaRoundTrip(t *testing.T) {
	b := Block{Component: "svc", Origin: OriginManual, DependsOn: []string{"a,b", "c", "d,e,f"}}
	got, err := ParseBlock(b.Serialize())
	if err != nil {
		t.Fatalf("ParseBlock: %v", err)
	}
	if !reflect.DeepEqual(got.DependsOn, b.DependsOn) {
		t.Fatalf("quoted-comma dependsOn did not round-trip:\n got: %#v\nwant: %#v", got.DependsOn, b.DependsOn)
	}
	// And the serialized form actually quotes the comma-bearing items.
	if !strings.Contains(b.Serialize(), `dependsOn: ["a,b", c, "d,e,f"]`) {
		t.Fatalf("serialized dependsOn not as expected: %q", b.Serialize())
	}
}
