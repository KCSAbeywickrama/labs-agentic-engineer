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
	"fmt"
	"testing"
)

// designWithParams renders a schema-valid component design.json whose single
// platform-resource dependency carries the given raw `parameters` JSON literal.
func designWithParams(paramsJSON string) string {
	return fmt.Sprintf(`{
  "name": "orders-db-owner",
  "type": "service",
  "version": "0.1.0",
  "language": "Go",
  "buildpack": "docker",
  "appPath": "svc",
  "entrypoint": "cmd/main",
  "exposure": "internet",
  "description": "owns orders data",
  "dependencies": [
    {
      "kind": "platform-resource",
      "name": "orders-db",
      "resourceType": "postgres-cnpg",
      "parameters": %s
    }
  ]
}`, paramsJSON)
}

// TestValidateComponentDesign_Parameters locks the parameters value rule in
// parity with the zod gate (component-design-schema.ts:
// z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))): mixed
// scalar values are accepted, non-scalar values reject. This is the write-gate
// half of the fold-parity fix for the number-vs-string divergence.
func TestValidateComponentDesign_Parameters(t *testing.T) {
	const dir = "orders-db-owner"

	accept := []struct {
		name   string
		params string
	}{
		// The postgres-cnpg shape: instances is an integer, storage/version strings.
		{"mixed scalars (number + strings)", `{ "instances": 1, "storage": "5Gi", "version": "16" }`},
		{"boolean value", `{ "highAvailability": true }`},
		{"empty object", `{}`},
	}
	for _, tc := range accept {
		t.Run("accept/"+tc.name, func(t *testing.T) {
			if p := validateComponentDesign(designWithParams(tc.params), dir); p != nil {
				t.Fatalf("expected accept, got reject: %s", p.message)
			}
		})
	}

	reject := []struct {
		name   string
		params string
	}{
		{"object value", `{ "instances": { "nested": 1 } }`},
		{"array value", `{ "zones": ["a", "b"] }`},
		{"null value", `{ "instances": null }`},
		{"parameters not an object", `"not-an-object"`},
	}
	for _, tc := range reject {
		t.Run("reject/"+tc.name, func(t *testing.T) {
			p := validateComponentDesign(designWithParams(tc.params), dir)
			if p == nil {
				t.Fatalf("expected reject for params %s, got accept", tc.params)
			}
			if p.code != ErrSchemaViolation {
				t.Fatalf("code = %q, want %q", p.code, ErrSchemaViolation)
			}
		})
	}
}
