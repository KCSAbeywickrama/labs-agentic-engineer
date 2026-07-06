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

// UNIT tier: the external-resource secret class of the proxy apply chain. When
// Inputs.ExternalResourceSRs is populated the dispatcher emits one additional
// per-run ExternalSecret per bundle (one data entry per key, localKey ==
// property == key) and the Job mounts each via envFrom so every key is a runner
// env var.

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

func TestDispatch_ExternalResourceSecretsEmittedAndMounted(t *testing.T) {
	cap := newCaptureProxy()
	d := New(newProxyClient(t, cap))

	in := baseDispatchInputs()
	in.ExternalResourceSRs = []ExternalResourceSecretInputs{
		{KVPath: "user-app-secrets/default/todo-weather-development", Keys: []string{"OPENWEATHER_API_KEY", "OPENWEATHER_HOST"}},
		{KVPath: "", Keys: []string{"IGNORED"}}, // empty path → skipped
	}

	if _, err := d.Dispatch(context.Background(), in); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	ns := tenant.RemoteWorkerNamespace(testOrgUUID)

	// anthropic + github + one external-resource ES = 3 ExternalSecrets (the
	// empty-path bundle is skipped).
	esBodies := cap.bodiesFor("POST", "/apis/external-secrets.io/v1/namespaces/"+ns+"/externalsecrets")
	if len(esBodies) != 3 {
		t.Fatalf("want 3 ExternalSecrets (anthropic + github + 1 external-resource), got %d", len(esBodies))
	}

	// Find the external-resource ES by its two data entries.
	var extRes map[string]any
	for _, raw := range esBodies {
		m := decodeManifest(t, raw)
		spec := m["spec"].(map[string]any)
		data, _ := spec["data"].([]any)
		if len(data) == 2 {
			extRes = m
			break
		}
	}
	if extRes == nil {
		t.Fatalf("no ExternalSecret with 2 data entries found among %d", len(esBodies))
	}
	spec := extRes["spec"].(map[string]any)
	data := spec["data"].([]any)
	keys := map[string]bool{}
	for _, e := range data {
		entry := e.(map[string]any)
		keys[entry["secretKey"].(string)] = true
		rr := entry["remoteRef"].(map[string]any)
		// localKey == property == key.
		if rr["property"] != entry["secretKey"] {
			t.Fatalf("external-resource ES: property must equal secretKey, got %v vs %v", rr["property"], entry["secretKey"])
		}
	}
	if !keys["OPENWEATHER_API_KEY"] || !keys["OPENWEATHER_HOST"] {
		t.Fatalf("external-resource ES missing expected keys, got %v", keys)
	}
	target := spec["target"].(map[string]any)
	secretName := target["name"].(string)

	// The Job must mount the external-resource secret via envFrom.
	jobBody := decodeManifest(t, cap.bodiesFor("POST", "/apis/batch/v1/namespaces/"+ns+"/jobs")[0])
	container := jobBody["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)["containers"].([]any)[0].(map[string]any)
	envFrom := container["envFrom"].([]any)
	found := false
	for _, ef := range envFrom {
		sr := ef.(map[string]any)["secretRef"].(map[string]any)
		if sr["name"] == secretName {
			found = true
		}
	}
	if !found {
		t.Fatalf("Job envFrom must reference the external-resource secret %q, got %v", secretName, envFrom)
	}
}
