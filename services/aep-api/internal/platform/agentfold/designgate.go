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

// designgate.go — the component design.json write-gate, an EXACT
// accept/reject port of packages/agent-stream/src/component-design-schema.ts
// checkComponentDesign (the zod gate the TS FileBundle runs on every write).
//
// Deliberately NOT delegated to internal/platform/designspec: for the fold,
// parity with the agent's gate wins — a write the agent applied must fold
// here too, or the manifest check fails a healthy turn. The historic
// divergence (zod accepted unknown CONNECTION properties while the published
// component-design.schema.json pins `additionalProperties: false`) was
// RECONCILED in Phase 5: the zod gate is strict now, and this port matches.
// Messages are designspec-flavored; message text is log-only.

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// componentDesignRe is COMPONENT_DESIGN_JSON_RE.
var componentDesignRe = regexp.MustCompile(`^specs/design/components/([^/]+)/design\.json$`)

type designProblem struct {
	code    ErrCode
	message string
}

var (
	designStringFields  = []string{"name", "type", "version", "language", "buildpack", "appPath", "entrypoint", "description"}
	exposureValues      = map[string]bool{"internet": true, "intranet": true}
	connectionTypes     = map[string]bool{"http": true, "datastore": true, "connector": true}
	connectionKnownKeys = map[string]bool{"to": true, "type": true, "onPlatform": true}
	designKnownKeys     = map[string]bool{
		"name": true, "type": true, "version": true, "language": true,
		"buildpack": true, "appPath": true, "entrypoint": true,
		"exposure": true, "connections": true, "description": true,
	}
)

// validateComponentDesign mirrors the zod componentDesignSchema.safeParse plus
// the name-equals-directory rule. Only the FIRST problem is reported (the
// accept/reject outcome is what parity needs).
func validateComponentDesign(content, dirName string) *designProblem {
	var parsed any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return &designProblem{code: ErrInvalidJSON, message: "content is not valid JSON: " + err.Error()}
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "must be an object"}
	}
	// z.strictObject: unknown TOP-LEVEL properties reject.
	for k := range obj {
		if !designKnownKeys[k] {
			return &designProblem{code: ErrSchemaViolation, message: "unknown property " + k}
		}
	}
	for _, field := range designStringFields {
		s, ok := obj[field].(string)
		if !ok {
			return &designProblem{code: ErrSchemaViolation, message: field + ": must be a string"}
		}
		if s == "" {
			return &designProblem{code: ErrSchemaViolation, message: field + ": must be at least 1 characters"}
		}
	}
	exposure, ok := obj["exposure"].(string)
	if !ok || !exposureValues[exposure] {
		return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("exposure: %q is not an allowed value", obj["exposure"])}
	}
	conns, ok := obj["connections"].([]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "connections: must be an array"}
	}
	for i, c := range conns {
		conn, ok := c.(map[string]any)
		if !ok {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("connections[%d]: must be an object", i)}
		}
		to, ok := conn["to"].(string)
		if !ok || to == "" {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("connections[%d].to: must be a non-empty string", i)}
		}
		ct, ok := conn["type"].(string)
		if !ok || !connectionTypes[ct] {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("connections[%d].type: %q is not an allowed value", i, conn["type"])}
		}
		if op, present := conn["onPlatform"]; present {
			if _, ok := op.(bool); !ok {
				return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("connections[%d].onPlatform: must be a boolean", i)}
			}
		}
		// z.strictObject (Phase-5 reconciliation): unknown connection
		// properties reject, matching the published schema + save gate.
		for k := range conn {
			if !connectionKnownKeys[k] {
				return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("connections[%d]: unknown property %s", i, k)}
			}
		}
	}
	if name := obj["name"].(string); name != dirName {
		return &designProblem{
			code:    ErrSchemaViolation,
			message: fmt.Sprintf("name %q must equal the component directory name %q", name, dirName),
		}
	}
	return nil
}
