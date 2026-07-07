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

// Unit tier (docs/design/org-config-consolidation.md §5.A). These rows ARE the
// contract for the omittable-nullable field the /config PATCH surface is built
// on: absent vs null vs value must be distinguishable, and the generated schema
// must reference the section schema rather than inline it per use.
package patch_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/platform/humakit/patch"
)

// sampleWrite stands in for a real section-write struct (LLMWrite etc).
type sampleWrite struct {
	Kind string `json:"kind" enum:"anthropic" required:"true"`
	Key  string `json:"key" required:"true"`
}

// sampleBody mirrors ConfigPatch: an omittable section field.
type sampleBody struct {
	Sec patch.Field[sampleWrite] `json:"sec,omitempty"`
}

// A1: key absent from the body → Sent=false (the untouched-section signal).
func TestField_AbsentIsNotSent(t *testing.T) {
	var b sampleBody
	if err := json.Unmarshal([]byte(`{}`), &b); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if b.Sec.Sent {
		t.Fatalf("absent key must leave Sent=false, got %+v", b.Sec)
	}
	if b.Sec.Null {
		t.Fatalf("absent key must leave Null=false, got %+v", b.Sec)
	}
}

// A2: explicit null → Sent=true, Null=true (the clear signal).
func TestField_NullIsSentAndNull(t *testing.T) {
	var b sampleBody
	if err := json.Unmarshal([]byte(`{"sec":null}`), &b); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !b.Sec.Sent || !b.Sec.Null {
		t.Fatalf("explicit null must be Sent && Null, got %+v", b.Sec)
	}
	if b.Sec.Value != (sampleWrite{}) {
		t.Fatalf("null must not populate Value, got %+v", b.Sec.Value)
	}
}

// A3: a value → Sent=true, Null=false, decoded into Value.
func TestField_ValueIsSentAndDecoded(t *testing.T) {
	var b sampleBody
	if err := json.Unmarshal([]byte(`{"sec":{"kind":"anthropic","key":"k123"}}`), &b); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !b.Sec.Sent || b.Sec.Null {
		t.Fatalf("value must be Sent && !Null, got %+v", b.Sec)
	}
	if b.Sec.Value.Kind != "anthropic" || b.Sec.Value.Key != "k123" {
		t.Fatalf("value not decoded: %+v", b.Sec.Value)
	}
}

// A4: the generated field schema is T's object schema marked Nullable — Huma's
// validator accepts a JSON null (clear) via the Nullable short-circuit and
// validates a present value against the object (its required inner fields). The
// field itself is NOT required (absent = keep). Rendered JSON is
// `type: ["object","null"]`.
func TestField_SchemaIsNullableObject(t *testing.T) {
	r := huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer)
	s := r.Schema(reflect.TypeFor[sampleBody](), false, "")

	field, ok := s.Properties["sec"]
	if !ok {
		t.Fatalf("schema missing 'sec' property: %+v", s.Properties)
	}
	if !field.Nullable {
		t.Fatalf("section field must be Nullable so a JSON null validates, got %+v", field)
	}
	if field.Type != "object" {
		t.Fatalf("section field must carry the object type, got %q", field.Type)
	}
	// The inner required fields are preserved, so a malformed section still 422s.
	if _, ok := field.Properties["kind"]; !ok {
		t.Fatalf("section field must keep the inner properties (kind), got %+v", field.Properties)
	}
	if len(field.Required) == 0 {
		t.Fatalf("section field must keep its required inner fields, got %v", field.Required)
	}
	// Rendered JSON is `type: ["object","null"]`.
	raw, err := field.MarshalJSON()
	if err != nil {
		t.Fatalf("marshal field schema: %v", err)
	}
	if !strings.Contains(string(raw), `"null"`) || !strings.Contains(string(raw), `"object"`) {
		t.Fatalf("rendered field schema must be nullable object, got %s", raw)
	}

	// Absent must mean "keep" — an omittable section is never required.
	for _, req := range s.Required {
		if req == "sec" {
			t.Fatalf("omittable section must not be required, got required=%v", s.Required)
		}
	}
}
