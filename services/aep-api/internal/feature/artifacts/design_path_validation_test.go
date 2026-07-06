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

package artifacts

// Path-validation tables for the design-side validators. The requirements-side
// validators (validateRelPath / validateRequirementFilename / RequirementFilePath)
// are already pinned in artifact_versioning_test.go — not re-tested here.

import "testing"

func TestValidateDesignSubPath(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"root design", "design.md", false},
		{"nested component design", "components/user-api/design.json", false},
		{"nested openapi yaml", "components/user-api/openapi.yaml", false},
		{"nested openapi yml", "components/user-api/openapi.yml", false},

		{"empty", "", true},
		{"backslash", "components\\user-api\\design.md", true},
		{"absolute", "/design.md", true},
		{"traversal", "components/../../../etc/passwd", true},
		{"trailing slash non-canonical", "components/user-api/", true},
		{"double slash non-canonical", "components//user-api/design.json", true},
		{"disallowed extension", "components/user-api/notes.txt", true},
		{"no extension", "components/user-api/design", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateDesignSubPath(tc.in)
			if tc.wantErr != (err != nil) {
				t.Errorf("validateDesignSubPath(%q) err=%v, wantErr=%v", tc.in, err, tc.wantErr)
			}
		})
	}
}

func TestValidateDesignSubDir(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"component dir", "components/user-api", false},
		{"single segment", "components", false},

		{"empty", "", true},
		{"dot", ".", true}, // "." splits to a "." segment -> rejected
		{"backslash", "components\\user-api", true},
		{"absolute", "/components", true},
		{"traversal", "components/../secrets", true},
		{"trailing slash non-canonical", "components/", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateDesignSubDir(tc.in)
			if tc.wantErr != (err != nil) {
				t.Errorf("validateDesignSubDir(%q) err=%v, wantErr=%v", tc.in, err, tc.wantErr)
			}
		})
	}
}

func TestDesignFilePath_Join(t *testing.T) {
	got, err := DesignFilePath("components/user-api/design.json")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := "specs/design/components/user-api/design.json"; got != want {
		t.Errorf("DesignFilePath = %q, want %q", got, want)
	}

	if _, err := DesignFilePath("../escape.md"); err == nil {
		t.Error("DesignFilePath should reject a traversal path")
	}
}
