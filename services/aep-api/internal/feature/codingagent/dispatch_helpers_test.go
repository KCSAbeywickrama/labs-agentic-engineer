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

// UNIT tier: the pure decision helpers inside dispatch_service.go. The full
// DispatchTasks/dispatchOne/tryDispatchViaProxy orchestration is INTEGRATION-
// OWNED (it fans out over *orgcreds.CredentialService, component services, the
// artifact store, and the DB — concrete deps with no mockable ports; every demo
// exercises it end-to-end). These helpers, by contrast, encode the load-bearing
// branch logic — deploy-gating, run-name derivation, the gateway-vs-local auth
// decision — and are honestly unit-testable in isolation.

import (
	"context"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/models"
)

func TestDepsAllDeployed(t *testing.T) {
	deployed := string(models.TaskStatusDeployed)
	pending := string(models.TaskStatusPending)

	// No deps → always dispatchable.
	if !depsAllDeployed(&models.ComponentTask{}, map[string]string{}) {
		t.Fatal("task with no deps must be dispatchable")
	}

	task := &models.ComponentTask{DependsOnComponents: models.StringSlice{"db", "cache"}}

	// All deps deployed → true.
	if !depsAllDeployed(task, map[string]string{"db": deployed, "cache": deployed}) {
		t.Fatal("all deps deployed must be dispatchable")
	}
	// One dep not deployed → false.
	if depsAllDeployed(task, map[string]string{"db": deployed, "cache": pending}) {
		t.Fatal("a non-deployed dep must block dispatch")
	}
	// Unknown dep name → fail closed (false), never fail open on a bad identifier.
	if depsAllDeployed(task, map[string]string{"db": deployed}) {
		t.Fatal("an unknown dep component must fail closed")
	}
}

func TestCodingAgentRunName_ShapeAndNewPathClassification(t *testing.T) {
	task := &models.ComponentTask{ID: "abcdef12-3456-7890-abcd-ef1234567890"}
	name := codingAgentRunName(task)

	if !strings.HasPrefix(name, "ca-abcdef12-") {
		t.Fatalf("run name must embed the ca- prefix + 8-char task id, got %q", name)
	}
	if len(name) > 63 {
		t.Fatalf("run name must fit the K8s 63-char label limit, got %d (%q)", len(name), name)
	}
	// The proxy dispatcher's run-name format is exactly what the progress
	// service keys its new-path branch on — pin that coupling so a change to one
	// can't silently desync the other.
	if !isNewPathRunName(name) {
		t.Fatalf("codingAgentRunName output must classify as a new-path run name: %q", name)
	}
	// Legacy ClusterWorkflow names must NOT classify as new-path.
	if isNewPathRunName("coding-agent-abcdef12-1700000000000") {
		t.Fatal("legacy coding-agent-… names must not be treated as new-path")
	}
}

func TestIsGatewayPlatformURL(t *testing.T) {
	cases := map[string]bool{
		"https://bff.example.com":       true,
		"HTTPS://bff.example.com":       true,  // case-insensitive
		"  https://bff.example.com ":    true,  // trimmed
		"http://host.k3d.internal:9090": false, // local k3d
		"":                              false,
	}
	for in, want := range cases {
		if got := isGatewayPlatformURL(in); got != want {
			t.Fatalf("isGatewayPlatformURL(%q) = %v; want %v", in, got, want)
		}
	}
}

func TestDeriveTokenURLFromJWKS(t *testing.T) {
	if got := deriveTokenURLFromJWKS("https://thunder.example.com/oauth2/jwks"); got != "https://thunder.example.com/oauth2/token" {
		t.Fatalf("token URL swap: got %q", got)
	}
	// A shape we don't recognise → "" so the caller skips the publisher path.
	if got := deriveTokenURLFromJWKS("https://thunder.example.com/keys"); got != "" {
		t.Fatalf("unrecognised JWKS URL must yield empty, got %q", got)
	}
	if got := deriveTokenURLFromJWKS(""); got != "" {
		t.Fatalf("empty JWKS URL must yield empty, got %q", got)
	}
}

func TestFirstExternalURL(t *testing.T) {
	if got := firstExternalURL(nil); got != "" {
		t.Fatalf("nil list → empty, got %q", got)
	}
	list := &models.DeploymentList{Items: []models.Deployment{
		{EndpointURL: ""},                 // skipped
		{EndpointURL: "https://api.dev/"}, // first non-empty wins
		{EndpointURL: "https://api.staging/"},
	}}
	if got := firstExternalURL(list); got != "https://api.dev/" {
		t.Fatalf("first non-empty external URL: got %q", got)
	}
}

func TestOCEntrypoint(t *testing.T) {
	if got := ocEntrypoint("web-app"); got != "deployment/web-application" {
		t.Fatalf("web-app entrypoint: %q", got)
	}
	if got := ocEntrypoint("Web-App"); got != "deployment/web-application" {
		t.Fatalf("entrypoint must be case-insensitive: %q", got)
	}
	if got := ocEntrypoint("service"); got != "deployment/service" {
		t.Fatalf("service entrypoint: %q", got)
	}
	if got := ocEntrypoint(""); got != "deployment/service" {
		t.Fatalf("unknown type defaults to service, got %q", got)
	}
}

func TestBuildAgentPrompt(t *testing.T) {
	task := &models.ComponentTask{IssueURL: "https://github.com/acme/demo/issues/7", IssueNumber: 7}
	prompt := buildAgentPrompt(task)
	if !strings.Contains(prompt, "https://github.com/acme/demo/issues/7") {
		t.Fatalf("prompt must point at the issue: %q", prompt)
	}
	// The literal `Closes #N` is what links the PR back to the task via webhook.
	if !strings.Contains(prompt, "Closes #7") {
		t.Fatalf("prompt must instruct the agent to write `Closes #7`: %q", prompt)
	}
}

func TestFailResult(t *testing.T) {
	r := failResult(DispatchResult{TaskID: "t1", ComponentName: "api"}, "boom")
	if r.Status != "failed" || r.Error != "boom" {
		t.Fatalf("failResult: %+v", r)
	}
	// Identity fields are preserved.
	if r.TaskID != "t1" || r.ComponentName != "api" {
		t.Fatalf("failResult must preserve identity: %+v", r)
	}
}

func TestDispatchCascadeHook_NilGuardsNoDispatch(t *testing.T) {
	// The nil-guards need no DB: a nil-DB hook must not dispatch, and a nil
	// receiver must not panic. (The delegation + advisory-lock path is proven
	// over real Postgres in dispatch_cascade_dbtest_test.go.)
	dispatch := &fakeDispatchService{}
	NewDispatchCascadeHook(nil, dispatch).OnTaskDeployed(context.Background(), "acme", "p1", "api")
	if len(dispatch.dispatchCalls()) != 0 {
		t.Fatal("nil-DB hook must not dispatch")
	}

	var nilHook *DispatchCascadeHook
	nilHook.OnTaskDeployed(context.Background(), "acme", "p1", "api") // must not panic
}
