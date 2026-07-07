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

// Package patch provides the omittable-nullable field wrapper that PATCH-style
// request bodies need. A plain *T can only tell "present" from "absent"; a JSON
// merge PATCH also has to distinguish an explicit `null` (clear the value) from
// an omitted key (leave it untouched). Field[T] captures all three states so a
// handler can branch on Sent/Null.
//
// It follows Huma's documented omittable-nullable recipe (huma v2's own
// schema_test.go OmittableNullable example): a custom json.Unmarshaler records
// whether the key was sent and whether it was null, and a huma.SchemaProvider
// renders the field as `oneOf: [<section schema>, {type: null}]` so the section
// schema is referenced (not inlined per use) and the null branch is explicit in
// the generated OpenAPI. See docs/design/org-config-consolidation.md §4.
package patch

import (
	"bytes"
	"encoding/json"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// Field is a three-state PATCH field wrapping a value of type T.
//
//   - key absent from the body      → Sent=false            (keep existing)
//   - key present and JSON null      → Sent=true, Null=true  (clear)
//   - key present with a value       → Sent=true, Null=false (replace with Value)
//
// The zero value is the "absent" state, which is what a struct field left
// unpopulated by json.Unmarshal reports — so a handler reads `.Sent` to decide
// whether a section was touched at all.
type Field[T any] struct {
	Sent  bool
	Null  bool
	Value T
}

// UnmarshalJSON records the tri-state. json.Unmarshal only calls this when the
// key is present in the object, so a false Sent unambiguously means "absent".
// An explicit `null` sets Null without touching Value; any other token decodes
// into Value.
func (f *Field[T]) UnmarshalJSON(b []byte) error {
	if len(b) == 0 {
		return nil
	}
	f.Sent = true
	if bytes.Equal(b, []byte("null")) {
		f.Null = true
		return nil
	}
	return json.Unmarshal(b, &f.Value)
}

// Schema makes the field validate as "T's object, or null". It follows Huma's
// documented recipe (schema_test.go OmittableNullable): take T's generated
// schema and mark it Nullable. Huma's request validator short-circuits a JSON
// null on a Nullable schema BEFORE it checks `type`, and validates a present
// value against T's full object schema (its required fields, its
// additionalProperties:false) otherwise. So a `null` clears, a well-formed
// object is accepted, and a malformed one 422s at the schema layer — all three
// PATCH states covered.
//
// The schema is requested inlined (allowRef=false) rather than as a $ref: Huma
// resolves a $ref away before the Nullable short-circuit runs, which would drop
// the null allowance. Each section type is used exactly once (in ConfigPatch),
// so inlining costs no reuse. A value receiver is required so Huma can call it
// on a zero Field value while introspecting the parent struct.
func (Field[T]) Schema(r huma.Registry) *huma.Schema {
	s := r.Schema(reflect.TypeFor[T](), false, "")
	s.Nullable = true
	return s
}
