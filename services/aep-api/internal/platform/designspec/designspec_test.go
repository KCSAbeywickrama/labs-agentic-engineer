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

package designspec

import (
	"errors"
	"testing"
)

const validComponent = `{
  "name": "orders-service",
  "type": "service",
  "version": "1.0",
  "language": "go",
  "buildpack": "go",
  "appPath": ".",
  "entrypoint": "main.go",
  "exposure": "intranet",
  "dependencies": [{"kind": "component", "name": "orders-db"}],
  "description": "Handles the order lifecycle"
}`

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want *ValidationError, got %v", err)
	}
	if ve.Code != code {
		t.Fatalf("code = %q, want %q (%s)", ve.Code, code, ve.Message)
	}
}

func TestValidComponentDesign(t *testing.T) {
	if err := ValidateComponentDesign([]byte(validComponent)); err != nil {
		t.Fatalf("valid component rejected: %v", err)
	}
}

func TestInvalidJSON(t *testing.T) {
	wantCode(t, ValidateComponentDesign([]byte("{ not json")), CodeInvalidJSON)
}

func TestMissingRequired(t *testing.T) {
	// Drop the required "description".
	raw := `{"name":"x","type":"service","version":"1","language":"go","buildpack":"go","appPath":".","entrypoint":"m","exposure":"intranet","dependencies":[]}`
	wantCode(t, ValidateComponentDesign([]byte(raw)), CodeSchemaViolation)
}

func TestBadEnum(t *testing.T) {
	raw := `{"name":"x","type":"service","version":"1","language":"go","buildpack":"go","appPath":".","entrypoint":"m","exposure":"public","dependencies":[],"description":"d"}`
	wantCode(t, ValidateComponentDesign([]byte(raw)), CodeSchemaViolation)
}

func TestAdditionalProperty(t *testing.T) {
	raw := `{"name":"x","type":"service","version":"1","language":"go","buildpack":"go","appPath":".","entrypoint":"m","exposure":"intranet","dependencies":[],"description":"d","surprise":true}`
	wantCode(t, ValidateComponentDesign([]byte(raw)), CodeSchemaViolation)
}

func TestDependencyMissingKind(t *testing.T) {
	// A dependency entry missing the required "kind" → SCHEMA_VIOLATION.
	raw := `{"name":"x","type":"service","version":"1","language":"go","buildpack":"go","appPath":".","entrypoint":"m","exposure":"intranet","dependencies":[{"name":"db"}],"description":"d"}`
	wantCode(t, ValidateComponentDesign([]byte(raw)), CodeSchemaViolation)
}

func TestNameMustEqualDir(t *testing.T) {
	if err := ValidateComponentDesignInDir([]byte(validComponent), "orders-service"); err != nil {
		t.Fatalf("matching dir rejected: %v", err)
	}
	wantCode(t, ValidateComponentDesignInDir([]byte(validComponent), "payments"), CodeSchemaViolation)
}
