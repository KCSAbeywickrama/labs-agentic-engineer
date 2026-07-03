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

package codingagent

// UNIT tier: the ESO ExternalSecret manifest builder branches not covered by
// job_template_test.go's TestBuildExternalSecret_Defaults — the multi-field
// DataEntries shape, refreshInterval override, owner-references, and the
// validation guards that keep a malformed manifest from reaching the proxy.

import (
	"strings"
	"testing"
)

// singleFieldES is a fully-populated single-field input for mutation tests.
func singleFieldES() ExternalSecretInputs {
	return ExternalSecretInputs{
		Name:                   "run-abc-anthropic-es",
		Namespace:              "wc-x-y-remote-worker",
		TargetSecretName:       "run-abc-anthropic",
		ClusterSecretStoreName: "secretstore-read",
		RemoteRefKey:           "user-app-secrets/default/cred-anthropic-abc",
		RemoteRefProperty:      "api-key",
		LocalKey:               "ANTHROPIC_API_KEY",
	}
}

func TestBuildExternalSecret_SingleFieldDataShape(t *testing.T) {
	es, err := BuildExternalSecret(singleFieldES())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	spec := es["spec"].(map[string]any)
	data := spec["data"].([]map[string]any)
	if len(data) != 1 {
		t.Fatalf("single-field shape must emit exactly one data entry, got %d", len(data))
	}
	if data[0]["secretKey"] != "ANTHROPIC_API_KEY" {
		t.Fatalf("secretKey = %v; want ANTHROPIC_API_KEY", data[0]["secretKey"])
	}
	ref := data[0]["remoteRef"].(map[string]any)
	if ref["key"] != "user-app-secrets/default/cred-anthropic-abc" || ref["property"] != "api-key" {
		t.Fatalf("remoteRef = %v", ref)
	}
	// secretStoreRef targets a ClusterSecretStore (not a namespaced SecretStore).
	ssr := spec["secretStoreRef"].(map[string]any)
	if ssr["name"] != "secretstore-read" || ssr["kind"] != "ClusterSecretStore" {
		t.Fatalf("secretStoreRef = %v", ssr)
	}
}

func TestBuildExternalSecret_MultiFieldDataEntries(t *testing.T) {
	// The publisher cc shape: one shared KV path, two data entries mapping to
	// distinct K8s Secret keys. RemoteRefProperty/LocalKey left empty and the
	// DataEntries branch takes over.
	es, err := BuildExternalSecret(ExternalSecretInputs{
		Name:                   "run-abc-publisher-es",
		Namespace:              "wc-x-y-remote-worker",
		TargetSecretName:       "run-abc-publisher",
		ClusterSecretStoreName: "secretstore-read",
		RemoteRefKey:           "user-app-secrets/default/idp-abc",
		DataEntries: []ExternalSecretDataEntry{
			{LocalKey: "PUBLISHER_CLIENT_ID", RemoteRefProperty: "client_id"},
			{LocalKey: "PUBLISHER_CLIENT_SECRET", RemoteRefProperty: "client_secret"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	data := es["spec"].(map[string]any)["data"].([]map[string]any)
	if len(data) != 2 {
		t.Fatalf("multi-field shape must emit two data entries, got %d", len(data))
	}
	// Both entries share the same KV path; only the property (and local key) differ.
	for i, want := range []struct{ key, prop string }{
		{"PUBLISHER_CLIENT_ID", "client_id"},
		{"PUBLISHER_CLIENT_SECRET", "client_secret"},
	} {
		if data[i]["secretKey"] != want.key {
			t.Fatalf("entry %d secretKey = %v; want %s", i, data[i]["secretKey"], want.key)
		}
		ref := data[i]["remoteRef"].(map[string]any)
		if ref["key"] != "user-app-secrets/default/idp-abc" {
			t.Fatalf("entry %d shared KV path drifted: %v", i, ref["key"])
		}
		if ref["property"] != want.prop {
			t.Fatalf("entry %d property = %v; want %s", i, ref["property"], want.prop)
		}
	}
}

func TestBuildExternalSecret_RefreshIntervalOverridePreserved(t *testing.T) {
	// "0" disables ESO refresh (one-shot). It must be preserved verbatim, NOT
	// coerced to the 5m default — the empty-string default branch is distinct.
	in := singleFieldES()
	in.RefreshInterval = "0"
	es, err := BuildExternalSecret(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := es["spec"].(map[string]any)["refreshInterval"]; got != "0" {
		t.Fatalf(`refreshInterval = %v; want "0" (one-shot, not defaulted)`, got)
	}
}

func TestBuildExternalSecret_OwnerReferencesEmittedOnlyWhenBothSet(t *testing.T) {
	// ownerReferences ride only when BOTH name + uid are present (GC when the
	// parent Job is deleted). A half-set pair must NOT stamp a dangling ref.
	in := singleFieldES()
	in.OwnerRunName = "run-abc"
	in.OwnerRunUID = "" // uid missing → no owner ref
	es, err := BuildExternalSecret(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := es["metadata"].(map[string]any)["ownerReferences"]; ok {
		t.Fatal("ownerReferences must be absent when uid is empty")
	}

	in.OwnerRunUID = "uid-123"
	es, err = BuildExternalSecret(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	refs, ok := es["metadata"].(map[string]any)["ownerReferences"].([]map[string]any)
	if !ok || len(refs) != 1 {
		t.Fatalf("ownerReferences must be present with both set, got %v", es["metadata"])
	}
	if refs[0]["name"] != "run-abc" || refs[0]["uid"] != "uid-123" || refs[0]["kind"] != "Job" {
		t.Fatalf("owner ref shape: %v", refs[0])
	}
	if refs[0]["controller"] != true || refs[0]["blockOwnerDeletion"] != true {
		t.Fatalf("owner ref must set controller + blockOwnerDeletion: %v", refs[0])
	}
}

func TestBuildExternalSecret_MissingSingleFieldFails(t *testing.T) {
	// Each required single-field key, dropped one at a time, must fail validation
	// before a manifest is produced.
	base := singleFieldES()
	for _, drop := range []struct {
		name string
		mut  func(*ExternalSecretInputs)
	}{
		{"Name", func(in *ExternalSecretInputs) { in.Name = "" }},
		{"Namespace", func(in *ExternalSecretInputs) { in.Namespace = "" }},
		{"TargetSecretName", func(in *ExternalSecretInputs) { in.TargetSecretName = "" }},
		{"ClusterSecretStoreName", func(in *ExternalSecretInputs) { in.ClusterSecretStoreName = "" }},
		{"RemoteRefKey", func(in *ExternalSecretInputs) { in.RemoteRefKey = "" }},
		{"RemoteRefProperty", func(in *ExternalSecretInputs) { in.RemoteRefProperty = "" }},
		{"LocalKey", func(in *ExternalSecretInputs) { in.LocalKey = "" }},
	} {
		t.Run(drop.name, func(t *testing.T) {
			in := base
			drop.mut(&in)
			if _, err := BuildExternalSecret(in); err == nil {
				t.Fatalf("missing %s must fail validation", drop.name)
			} else if !strings.Contains(err.Error(), drop.name) {
				t.Fatalf("error %v should mention %s", err, drop.name)
			}
		})
	}
}

func TestBuildExternalSecret_MissingDataEntryFieldsFail(t *testing.T) {
	// In the multi-field shape, a blank LocalKey/RemoteRefProperty on any entry
	// fails — the single-field RemoteRefProperty/LocalKey checks are bypassed.
	in := ExternalSecretInputs{
		Name:                   "es",
		Namespace:              "ns",
		TargetSecretName:       "sec",
		ClusterSecretStoreName: "css",
		RemoteRefKey:           "kv/path",
		DataEntries:            []ExternalSecretDataEntry{{LocalKey: "", RemoteRefProperty: "client_id"}},
	}
	if _, err := BuildExternalSecret(in); err == nil || !strings.Contains(err.Error(), "DataEntries[0].LocalKey") {
		t.Fatalf("blank DataEntries LocalKey must fail with an indexed message, got %v", err)
	}
}

func TestBuildExternalSecret_NameTooLongFails(t *testing.T) {
	in := singleFieldES()
	in.Name = strings.Repeat("a", 254) // > 253-char DNS subdomain limit
	if _, err := BuildExternalSecret(in); err == nil || !strings.Contains(err.Error(), "253") {
		t.Fatalf("over-long ExternalSecret name must fail, got %v", err)
	}
}
