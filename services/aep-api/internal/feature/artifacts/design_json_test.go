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

import (
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/models"
)

// fullComponentDesignJSON is a canonical `components/checkout/design.json`
// exercising all four dependency kinds and both platform-owned blocks. It is
// authored to be byte-identical to marshalComponentDesignJSON's output so the
// round-trip assertion is exact.
const fullComponentDesignJSON = `{
  "name": "checkout",
  "type": "service",
  "version": "0.1.0",
  "language": "Go",
  "buildpack": "docker",
  "appPath": "checkout",
  "entrypoint": "deployment/service",
  "exposure": "intranet",
  "description": "Owns order checkout. Does NOT handle payments capture.",
  "dependencies": [
    {
      "kind": "component",
      "name": "cart"
    },
    {
      "kind": "org-service",
      "name": "user-profile",
      "description": "cross-project profile lookup"
    },
    {
      "kind": "external",
      "name": "openweather",
      "description": "weather",
      "needsSpec": true,
      "specPath": "dependencies/openweather.openapi.yaml",
      "config": [
        {
          "key": "OPENWEATHER_API_KEY",
          "secret": true,
          "credentialClass": "secret"
        }
      ]
    },
    {
      "kind": "platform-resource",
      "name": "orders-db",
      "resourceType": "postgres",
      "parameters": {
        "size": "small"
      }
    }
  ],
  "exposesAPI": {
    "auth": "service-required",
    "orgPublished": true
  },
  "callerIdentity": {
    "mode": "service-account"
  },
  "componentAgentInstructions": "prefer stdlib net/http"
}
`

func TestParseComponentDesignJSON_AllKinds(t *testing.T) {
	comp, err := parseComponentDesignJSON("checkout", fullComponentDesignJSON)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if comp.Name != "checkout" || comp.ComponentType != "service" || comp.Version != "0.1.0" {
		t.Fatalf("base fields drifted: %+v", comp)
	}
	if comp.Language != "Go" || comp.Buildpack != "docker" || comp.AppPath != "checkout" ||
		comp.Entrypoint != "deployment/service" || comp.Exposure != "intranet" {
		t.Fatalf("scalar fields drifted: %+v", comp)
	}
	if comp.Description != "Owns order checkout. Does NOT handle payments capture." {
		t.Fatalf("description drifted: %q", comp.Description)
	}
	if comp.ComponentAgentInstructions != "prefer stdlib net/http" {
		t.Fatalf("componentAgentInstructions drifted: %q", comp.ComponentAgentInstructions)
	}
	if comp.ExposesAPI == nil || comp.ExposesAPI.Auth != "service-required" || !comp.ExposesAPI.OrgPublished {
		t.Fatalf("exposesAPI drifted: %+v", comp.ExposesAPI)
	}
	if comp.CallerIdentity == nil || comp.CallerIdentity.Mode != "service-account" {
		t.Fatalf("callerIdentity drifted: %+v", comp.CallerIdentity)
	}

	if len(comp.Dependencies) != 4 {
		t.Fatalf("want 4 dependencies, got %d: %+v", len(comp.Dependencies), comp.Dependencies)
	}
	got := comp.Dependencies
	if got[0].Kind != models.DependencyKindComponent || got[0].Name != "cart" {
		t.Fatalf("dep[0] drifted: %+v", got[0])
	}
	if got[1].Kind != models.DependencyKindOrgService || got[1].Name != "user-profile" ||
		got[1].Description != "cross-project profile lookup" {
		t.Fatalf("dep[1] drifted: %+v", got[1])
	}
	if got[2].Kind != models.DependencyKindExternal || got[2].Name != "openweather" ||
		!got[2].NeedsSpec || got[2].SpecPath != "dependencies/openweather.openapi.yaml" {
		t.Fatalf("dep[2] drifted: %+v", got[2])
	}
	// This external dep HAS a specPath, so it is NOT auto-unresolved.
	if got[2].Status != "" || got[2].Reason != "" {
		t.Fatalf("dep[2] must have no computed status (specPath set): %+v", got[2])
	}
	if len(got[2].Config) != 1 || got[2].Config[0].Key != "OPENWEATHER_API_KEY" || !got[2].Config[0].Secret {
		t.Fatalf("dep[2] config drifted: %+v", got[2].Config)
	}
	if got[3].Kind != models.DependencyKindPlatformResource || got[3].Name != "orders-db" ||
		got[3].ResourceType != "postgres" || got[3].Parameters["size"] != "small" {
		t.Fatalf("dep[3] drifted: %+v", got[3])
	}
}

func TestMarshalComponentDesignJSON_RoundTripByteIdentical(t *testing.T) {
	comp, err := parseComponentDesignJSON("checkout", fullComponentDesignJSON)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	out, err := marshalComponentDesignJSON("checkout", comp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(out) != fullComponentDesignJSON {
		t.Fatalf("round-trip not byte-identical:\n--- got ---\n%s\n--- want ---\n%s", out, fullComponentDesignJSON)
	}
	// A trailing newline keeps git diffs clean.
	if !strings.HasSuffix(string(out), "\n") {
		t.Fatalf("output must end with a trailing newline")
	}
}

func TestMarshalComponentDesignJSON_NeverEmitsStatusReason(t *testing.T) {
	// An external needs-spec dep whose Status/Reason were computed at read time
	// must never leak into the written file.
	comp := models.DesignComponent{
		Name:          "checkout",
		ComponentType: "service",
		Dependencies: []models.Dependency{
			{
				Kind:      models.DependencyKindExternal,
				Name:      "openweather",
				NeedsSpec: true,
				Status:    "unresolved", // computed — must be dropped
				Reason:    "needs-spec", // computed — must be dropped
			},
		},
	}
	out, err := marshalComponentDesignJSON("checkout", comp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(out), "status") || strings.Contains(string(out), "reason") {
		t.Fatalf("written design.json must not contain status/reason:\n%s", out)
	}
}

func TestParseComponentDesignJSON_UnknownTopLevelKeyRejected(t *testing.T) {
	raw := `{"name":"checkout","type":"service","dependencies":[],"connections":[]}`
	if _, err := parseComponentDesignJSON("checkout", raw); err == nil {
		t.Fatalf("expected unknown top-level key (connections) to be rejected")
	}
}

func TestParseComponentDesignJSON_StatusReasonInDependencyRejected(t *testing.T) {
	for _, key := range []string{"status", "reason"} {
		raw := `{"name":"checkout","type":"service","dependencies":[{"kind":"external","name":"x","` + key + `":"v"}]}`
		if _, err := parseComponentDesignJSON("checkout", raw); err == nil {
			t.Fatalf("expected %q inside a dependency entry to be rejected as an unknown key", key)
		}
	}
}

func TestParseComponentDesignJSON_UnknownDependencyKeyRejected(t *testing.T) {
	raw := `{"name":"checkout","type":"service","dependencies":[{"kind":"external","name":"x","bogus":1}]}`
	if _, err := parseComponentDesignJSON("checkout", raw); err == nil {
		t.Fatalf("expected unknown dependency key to be rejected")
	}
}

func TestParseComponentDesignJSON_NameMustEqualDir(t *testing.T) {
	raw := `{"name":"other","type":"service","dependencies":[]}`
	if _, err := parseComponentDesignJSON("checkout", raw); err == nil {
		t.Fatalf("expected name!=dir to be rejected")
	}
}

func TestParseComponentDesignJSON_NeedsSpecComputesUnresolved(t *testing.T) {
	// external + needsSpec + no specPath ⇒ status=unresolved, reason=needs-spec.
	raw := `{"name":"checkout","type":"service","dependencies":[{"kind":"external","name":"weather","needsSpec":true}]}`
	comp, err := parseComponentDesignJSON("checkout", raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(comp.Dependencies) != 1 {
		t.Fatalf("want 1 dep, got %d", len(comp.Dependencies))
	}
	d := comp.Dependencies[0]
	if d.Status != "unresolved" || d.Reason != "needs-spec" {
		t.Fatalf("needs-spec computation drifted: status=%q reason=%q", d.Status, d.Reason)
	}

	// A component-kind dep with needsSpec set is NOT external → no computation.
	raw2 := `{"name":"checkout","type":"service","dependencies":[{"kind":"component","name":"cart"}]}`
	comp2, err := parseComponentDesignJSON("checkout", raw2)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if comp2.Dependencies[0].Status != "" || comp2.Dependencies[0].Reason != "" {
		t.Fatalf("component dep must not get a computed status: %+v", comp2.Dependencies[0])
	}
}

func TestSplitAssembleDesign_ComponentRoundTrip(t *testing.T) {
	// End-to-end through the store split/assemble seam: a DesignFile with one
	// component survives Split → Assemble with the design.json codec.
	d := &DesignFile{
		Overview: "the system",
		Components: []models.DesignComponent{
			{
				Name:          "checkout",
				ComponentType: "service",
				Version:       "0.1.0",
				Language:      "Go",
				Description:   "Owns checkout.",
				Dependencies: []models.Dependency{
					{Kind: models.DependencyKindComponent, Name: "cart"},
				},
				OpenAPISpec: "openapi: 3.0.3\n",
			},
		},
	}
	files, err := SplitDesign(d)
	if err != nil {
		t.Fatalf("SplitDesign: %v", err)
	}
	if _, ok := files["components/checkout/design.json"]; !ok {
		t.Fatalf("expected components/checkout/design.json, got keys: %v", keysOf(files))
	}
	if _, ok := files["components/checkout/design.md"]; ok {
		t.Fatalf("component design.md must NOT be written any more")
	}
	out, err := AssembleDesign(files)
	if err != nil {
		t.Fatalf("AssembleDesign: %v", err)
	}
	if len(out.Components) != 1 {
		t.Fatalf("want 1 component, got %d", len(out.Components))
	}
	got := out.Components[0]
	if got.Name != "checkout" || got.Version != "0.1.0" || got.Description != "Owns checkout." {
		t.Fatalf("round-trip drifted: %+v", got)
	}
	if got.OpenAPISpec != "openapi: 3.0.3\n" {
		t.Fatalf("openapi.yaml must round-trip as a separate file: %q", got.OpenAPISpec)
	}
	if len(got.Dependencies) != 1 || got.Dependencies[0].Name != "cart" {
		t.Fatalf("dependency round-trip drifted: %+v", got.Dependencies)
	}
}
