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

package projects

import "testing"

// The model-access SecretReference must land in the SAME org namespace every
// other SecretReference for that org already lives in. That namespace is
// derived from the org's Thunder UUID, never from the OpenChoreo org handle —
// deriving it from the handle produced `wc-default-…`, a namespace that does
// not exist, so the create 500'd and agents deployed with no MODEL_*.
//
// Reading it out of the vault key the org's own row carries cannot disagree
// with where the key actually lives, in local or cloud.
func TestOrgNamespaceFromVaultKey(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		kvPath  string
		want    string
		wantErr bool
	}{
		{
			name:   "reads the org namespace a real key carries",
			kvPath: "user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets",
			want:   "wc-019f40d1-b04b186b",
		},
		{
			name:   "tolerates a leading slash",
			kvPath: "/user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets",
			want:   "wc-019f40d1-b04b186b",
		},
		{
			name:    "rejects a key with no namespace segment",
			kvPath:  "user-app-secrets/anthropic-secrets",
			wantErr: true,
		},
		{
			name:    "rejects a key under a different prefix",
			kvPath:  "some-other-store/wc-019f40d1-b04b186b/anthropic-secrets",
			wantErr: true,
		},
		{
			name:    "rejects an empty key",
			kvPath:  "",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := orgNamespaceFromVaultKey(tc.kvPath)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("orgNamespaceFromVaultKey(%q) = %q, nil; want an error", tc.kvPath, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("orgNamespaceFromVaultKey(%q): unexpected error: %v", tc.kvPath, err)
			}
			if got != tc.want {
				t.Errorf("orgNamespaceFromVaultKey(%q) = %q; want %q", tc.kvPath, got, tc.want)
			}
		})
	}
}

// The handle-derived namespace the bug produced must never be what we compute.
func TestOrgNamespaceFromVaultKey_isNotHandleDerived(t *testing.T) {
	t.Parallel()
	got, err := orgNamespaceFromVaultKey("user-app-secrets/wc-019f40d1-b04b186b/anthropic-secrets")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == "wc-default-37a8eec1" {
		t.Fatalf("computed the handle-derived namespace %q — that namespace does not exist", got)
	}
}
