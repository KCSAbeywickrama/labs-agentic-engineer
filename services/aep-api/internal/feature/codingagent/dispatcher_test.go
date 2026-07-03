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

// UNIT tier: the four-step proxy apply chain (Namespace → ServiceAccount →
// ExternalSecret×N → Job). The cluster-gateway-proxy is CONCRETE (no interface
// to moq), so it is faked at the WIRE via httptest and driven through the real
// clustergatewayproxy.Client — this exercises the real request-building + path
// derivation in client.go alongside the dispatcher's orchestration. Assertions
// pin the load-bearing fields the runner depends on: the derived namespace, the
// per-run secret names shared between the Job and the ExternalSecrets, the
// envFrom secret refs, the runner image, and the chain order.

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

const testOrgUUID = "11111111-2222-3333-4444-555555555555"

// baseDispatchInputs is a fully-populated no-publisher dispatch. Tests mutate
// a copy for the branches they cover.
func baseDispatchInputs() Inputs {
	job := validInputs() // from job_template_test.go
	// The orchestrator OVERWRITES OrgNS + the secret names; clear them so the
	// test proves the orchestrator computes them, not the caller.
	job.OrgNS = ""
	job.AnthropicSecretName = ""
	job.GitHubSecretName = ""
	job.PublisherSecretName = ""
	return Inputs{
		OrgUUID:                testOrgUUID,
		Job:                    job,
		AnthropicSR:            SecretRef{SecretRefName: "sr-anthropic", KVPath: "user-app-secrets/default/anthropic", Property: "api-key"},
		GitHubSR:               SecretRef{SecretRefName: "sr-github", KVPath: "user-app-secrets/default/github", Property: "token"},
		ClusterSecretStoreName: "secretstore-read",
	}
}

func decodeManifest(t testing.TB, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("decode manifest: %v\nraw=%s", err, string(raw))
	}
	return m
}

func TestDispatch_AppliesFullChainInOrder(t *testing.T) {
	cap := newCaptureProxy()
	d := New(newProxyClient(t, cap))

	runName, err := d.Dispatch(context.Background(), baseDispatchInputs())
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if runName != "run-abc12345" {
		t.Fatalf("Dispatch must echo the run name, got %q", runName)
	}

	ns := tenant.RemoteWorkerNamespace(testOrgUUID)
	// The chain must apply NS → SA → 2×ES → Job, in that order, all under the
	// derived per-org remote-worker namespace.
	want := []string{
		"POST /api/v1/namespaces",
		"POST /api/v1/namespaces/" + ns + "/serviceaccounts",
		"POST /apis/external-secrets.io/v1/namespaces/" + ns + "/externalsecrets",
		"POST /apis/external-secrets.io/v1/namespaces/" + ns + "/externalsecrets",
		"POST /apis/batch/v1/namespaces/" + ns + "/jobs",
	}
	got := cap.requestOrder()
	if len(got) != len(want) {
		t.Fatalf("chain length: got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("chain step %d: got %q want %q\nfull=%v", i, got[i], want[i], got)
		}
	}
}

func TestDispatch_NamespaceDerivationAndLabels(t *testing.T) {
	cap := newCaptureProxy()
	d := New(newProxyClient(t, cap))
	if _, err := d.Dispatch(context.Background(), baseDispatchInputs()); err != nil {
		t.Fatalf("dispatch: %v", err)
	}

	ns := tenant.RemoteWorkerNamespace(testOrgUUID)
	nsBody := decodeManifest(t, cap.bodiesFor("POST", "/api/v1/namespaces")[0])
	meta := nsBody["metadata"].(map[string]any)
	if meta["name"] != ns {
		t.Fatalf("namespace name = %v; want the derived %q", meta["name"], ns)
	}
	labels := meta["labels"].(map[string]any)
	if labels["aep.io/org-uuid"] != testOrgUUID {
		t.Fatalf("namespace must be labelled with the org UUID, got %v", labels)
	}
	if labels["aep.io/purpose"] != "remote-worker" {
		t.Fatalf("namespace purpose label: %v", labels)
	}
}

func TestDispatch_ExternalSecretsAndJobShareSecretNames(t *testing.T) {
	cap := newCaptureProxy()
	d := New(newProxyClient(t, cap))
	if _, err := d.Dispatch(context.Background(), baseDispatchInputs()); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	ns := tenant.RemoteWorkerNamespace(testOrgUUID)

	esBodies := cap.bodiesFor("POST", "/apis/external-secrets.io/v1/namespaces/"+ns+"/externalsecrets")
	if len(esBodies) != 2 {
		t.Fatalf("expected anthropic + github ExternalSecrets, got %d", len(esBodies))
	}
	// The per-run secret names are derived from the run name; the Job's envFrom
	// must reference EXACTLY the K8s Secrets the ExternalSecrets materialise, or
	// the runner pod starts without its creds.
	const runName = "run-abc12345"
	wantAnthropic := runName + "-anthropic"
	wantGitHub := runName + "-github"

	es0 := decodeManifest(t, esBodies[0])
	es1 := decodeManifest(t, esBodies[1])
	esTargets := map[string]map[string]any{
		esTargetName(t, es0): es0,
		esTargetName(t, es1): es1,
	}
	anthropicES, ok := esTargets[wantAnthropic]
	if !ok {
		t.Fatalf("no ExternalSecret targeting %q; targets=%v", wantAnthropic, keysOf(esTargets))
	}
	githubES, ok := esTargets[wantGitHub]
	if !ok {
		t.Fatalf("no ExternalSecret targeting %q; targets=%v", wantGitHub, keysOf(esTargets))
	}
	// Each ES materialises the correct env-var key from the correct SM-API path.
	assertESData(t, anthropicES, "ANTHROPIC_API_KEY", "user-app-secrets/default/anthropic", "api-key")
	assertESData(t, githubES, "GITHUB_TOKEN", "user-app-secrets/default/github", "token")

	// The Job's envFrom references both materialised Secrets.
	jobBody := decodeManifest(t, cap.bodiesFor("POST", "/apis/batch/v1/namespaces/"+ns+"/jobs")[0])
	envFrom := jobContainer(t, jobBody)["envFrom"].([]any)
	secretRefs := map[string]bool{}
	for _, ef := range envFrom {
		ref := ef.(map[string]any)["secretRef"].(map[string]any)
		secretRefs[ref["name"].(string)] = true
	}
	if !secretRefs[wantAnthropic] || !secretRefs[wantGitHub] {
		t.Fatalf("Job envFrom must reference both per-run secrets, got %v", secretRefs)
	}
	// No publisher on this path: exactly two envFrom entries.
	if len(envFrom) != 2 {
		t.Fatalf("no-publisher dispatch must have 2 envFrom entries, got %d", len(envFrom))
	}
	// Namespace + SA + image land on the Job from the orchestrator, not the caller.
	spec := jobBody["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
	if spec["serviceAccountName"] != "remote-worker-runner" {
		t.Fatalf("Job SA = %v; want remote-worker-runner", spec["serviceAccountName"])
	}
	if jobBody["metadata"].(map[string]any)["namespace"] != ns {
		t.Fatalf("Job namespace = %v; want %q", jobBody["metadata"].(map[string]any)["namespace"], ns)
	}
	if img := jobContainer(t, jobBody)["image"]; img != "docker.io/xlight05/aep-coding-agent-runner:v3" {
		t.Fatalf("Job image = %v", img)
	}
}

func TestDispatch_WithPublisherEmitsThirdExternalSecretAndEnvFrom(t *testing.T) {
	cap := newCaptureProxy()
	d := New(newProxyClient(t, cap))
	in := baseDispatchInputs()
	in.PublisherSR = &SecretRef{SecretRefName: "sr-pub", KVPath: "user-app-secrets/default/idp", Property: ""}
	if _, err := d.Dispatch(context.Background(), in); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	ns := tenant.RemoteWorkerNamespace(testOrgUUID)

	esBodies := cap.bodiesFor("POST", "/apis/external-secrets.io/v1/namespaces/"+ns+"/externalsecrets")
	if len(esBodies) != 3 {
		t.Fatalf("publisher path must emit 3 ExternalSecrets, got %d", len(esBodies))
	}
	// Find the publisher ES (the multi-field one) and assert its two data keys.
	var pubES map[string]any
	for _, raw := range esBodies {
		m := decodeManifest(t, raw)
		if esTargetName(t, m) == "run-abc12345-publisher" {
			pubES = m
		}
	}
	if pubES == nil {
		t.Fatal("no publisher ExternalSecret found")
	}
	data := pubES["spec"].(map[string]any)["data"].([]any)
	keys := map[string]bool{}
	for _, d := range data {
		keys[d.(map[string]any)["secretKey"].(string)] = true
	}
	if !keys["PUBLISHER_CLIENT_ID"] || !keys["PUBLISHER_CLIENT_SECRET"] {
		t.Fatalf("publisher ES must materialise both client_id + client_secret, got %v", keys)
	}

	// The Job gains a third envFrom secretRef for the publisher secret.
	jobBody := decodeManifest(t, cap.bodiesFor("POST", "/apis/batch/v1/namespaces/"+ns+"/jobs")[0])
	envFrom := jobContainer(t, jobBody)["envFrom"].([]any)
	if len(envFrom) != 3 {
		t.Fatalf("publisher dispatch must have 3 envFrom entries, got %d", len(envFrom))
	}
}

func TestDispatch_ValidationRejectsBeforeAnyApply(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*Inputs)
	}{
		{"empty OrgUUID", func(in *Inputs) { in.OrgUUID = "" }},
		{"missing ClusterSecretStore", func(in *Inputs) { in.ClusterSecretStoreName = "" }},
		{"unpopulated AnthropicSR", func(in *Inputs) { in.AnthropicSR = SecretRef{} }},
		{"unpopulated GitHubSR", func(in *Inputs) { in.GitHubSR = SecretRef{} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cap := newCaptureProxy()
			d := New(newProxyClient(t, cap))
			in := baseDispatchInputs()
			tc.mut(&in)
			if _, err := d.Dispatch(context.Background(), in); err == nil {
				t.Fatal("expected validation error")
			}
			// A validation refusal must not touch the cluster at all.
			if got := cap.requestOrder(); len(got) != 0 {
				t.Fatalf("validation failure must issue no proxy calls, got %v", got)
			}
		})
	}
}

func TestDispatch_ServiceAccountOverride(t *testing.T) {
	cap := newCaptureProxy()
	d := New(newProxyClient(t, cap)).WithServiceAccount("custom-runner")
	if _, err := d.Dispatch(context.Background(), baseDispatchInputs()); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	ns := tenant.RemoteWorkerNamespace(testOrgUUID)
	saBody := decodeManifest(t, cap.bodiesFor("POST", "/api/v1/namespaces/"+ns+"/serviceaccounts")[0])
	if saBody["metadata"].(map[string]any)["name"] != "custom-runner" {
		t.Fatalf("SA name = %v; want custom-runner", saBody["metadata"])
	}
	jobBody := decodeManifest(t, cap.bodiesFor("POST", "/apis/batch/v1/namespaces/"+ns+"/jobs")[0])
	spec := jobBody["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
	if spec["serviceAccountName"] != "custom-runner" {
		t.Fatalf("Job SA must match the override, got %v", spec["serviceAccountName"])
	}
}

// ---- decode helpers --------------------------------------------------------

func esTargetName(t testing.TB, es map[string]any) string {
	t.Helper()
	return es["spec"].(map[string]any)["target"].(map[string]any)["name"].(string)
}

func assertESData(t testing.TB, es map[string]any, wantKey, wantPath, wantProp string) {
	t.Helper()
	data := es["spec"].(map[string]any)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("single-field ES must have one data entry, got %d", len(data))
	}
	entry := data[0].(map[string]any)
	if entry["secretKey"] != wantKey {
		t.Fatalf("secretKey = %v; want %s", entry["secretKey"], wantKey)
	}
	ref := entry["remoteRef"].(map[string]any)
	if ref["key"] != wantPath || ref["property"] != wantProp {
		t.Fatalf("remoteRef = %v; want key=%s property=%s", ref, wantPath, wantProp)
	}
}

func jobContainer(t testing.TB, job map[string]any) map[string]any {
	t.Helper()
	containers := job["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)["containers"].([]any)
	if len(containers) == 0 {
		t.Fatal("job has no containers")
	}
	return containers[0].(map[string]any)
}

func keysOf(m map[string]map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
