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

package cmd

import (
	"context"
	"errors"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// fakeAPIPlatform serves List of APIGateways and RestApis from memory.
type fakeAPIPlatform struct {
	gateways []unstructured.Unstructured
	apis     []unstructured.Unstructured
	err      error
}

func (f *fakeAPIPlatform) List(_ context.Context, _, kind, _ string) ([]unstructured.Unstructured, error) {
	if f.err != nil {
		return nil, f.err
	}
	if kind == "APIGateway" {
		return f.gateways, nil
	}
	return f.apis, nil
}

// labelGateway is an APIGateway selecting on restAPITargetLabel=target, the
// shape both the API Platform and the AI gateway installs produce.
func labelGateway(ns, name, target, phase string) unstructured.Unstructured {
	return gatewayObject(ns, name, phase, map[string]interface{}{
		"scope":       string(scopeLabel),
		"matchLabels": map[string]interface{}{restAPITargetLabel: target},
	})
}

// clusterGateway is an APIGateway on the AI gateway chart's default selector.
func clusterGateway(ns, name string) unstructured.Unstructured {
	return gatewayObject(ns, name, "Ready", map[string]interface{}{"scope": string(scopeCluster)})
}

// The selector map holds plain strings, as a decoded object does: a typed
// constant would fail unstructured's string assertion.
func gatewayObject(ns, name, phase string, selector map[string]interface{}) unstructured.Unstructured {
	return unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": apiPlatformGatewayAPIVersion, "kind": "APIGateway",
		"metadata": map[string]interface{}{"name": name, "namespace": ns},
		"spec":     map[string]interface{}{"apiSelector": selector},
		"status":   map[string]interface{}{"phase": phase},
	}}
}

// restAPI is a RestApi labelled for target; an empty target leaves the label off.
func restAPI(ns, name, target string) unstructured.Unstructured {
	meta := map[string]interface{}{"name": name, "namespace": ns}
	if target != "" {
		meta["labels"] = map[string]interface{}{restAPITargetLabel: target}
	}
	return unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": apiPlatformGatewayAPIVersion, "kind": "RestApi",
		"metadata": meta,
	}}
}

func mustReport(t *testing.T, f *fakeAPIPlatform) gatewayReport {
	t.Helper()
	r, err := buildGatewayReport(context.Background(), f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return r
}

func TestBuildGatewayReport_ConvergedClusterHasNoFaults(t *testing.T) {
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{
			labelGateway("default-development", "api-platform-default-development", "api-platform-default-development", "Ready"),
			labelGateway("default-development", "ai-gateway-default-development", "ai-gateway-default-development", "Ready"),
		},
		apis: []unstructured.Unstructured{
			restAPI("dp-default-p70", "p70-hello-api-http", "api-platform-default-development"),
			restAPI("default-development", "api-platform-default-development-otel-restapi", "api-platform-default-development"),
		},
	})
	if len(r.Faults) != 0 {
		t.Fatalf("expected no faults, got %q", r.Faults)
	}
	if len(r.Gateways) != 2 || r.Gateways[0].Name != "ai-gateway-default-development" {
		t.Fatalf("expected both gateways sorted by name, got %+v", r.Gateways)
	}
	if r.Gateways[0].Scope != scopeLabel || r.Gateways[0].Phase != "Ready" {
		t.Fatalf("expected scope and phase read from the object, got %+v", r.Gateways[0])
	}
}

func TestBuildGatewayReport_ClusterScopedGatewayIsAFault(t *testing.T) {
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{
			labelGateway("default-development", "api-platform-default-development", "api-platform-default-development", "Ready"),
			clusterGateway("default-development", "ai-gateway-default-development"),
		},
		apis: []unstructured.Unstructured{
			restAPI("dp-default-p72", "p72-rooms-api-http", "api-platform-default-development"),
		},
	})
	// One fault for the gateway; the RestApi has exactly one other gateway
	// selecting it and is not reported a second time.
	if len(r.Faults) != 1 {
		t.Fatalf("expected one fault, got %q", r.Faults)
	}
	for _, want := range []string{"ai-gateway-default-development", "scope: Cluster", "all 1 RestApis"} {
		if !strings.Contains(r.Faults[0], want) {
			t.Fatalf("fault should contain %q, got %q", want, r.Faults[0])
		}
	}
}

func TestBuildGatewayReport_OnlyAClusterScopedGatewayStillServes(t *testing.T) {
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{clusterGateway("default-development", "ai-gateway-default-development")},
		apis:     []unstructured.Unstructured{restAPI("dp-default-p70", "p70-hello-api-http", "api-platform-default-development")},
	})
	if len(r.Faults) != 2 {
		t.Fatalf("expected the gateway and the RestApi reported, got %q", r.Faults)
	}
	if !strings.Contains(r.Faults[1], "only the Cluster-scoped ai-gateway-default-development can serve it") {
		t.Fatalf("the unserved line must not claim nothing serves it while a Cluster gateway exists, got %q", r.Faults[1])
	}
}

func TestBuildGatewayReport_UnservedRestApiIsAFault(t *testing.T) {
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{
			labelGateway("default-development", "api-platform-default-development", "api-platform-default-development", "Ready"),
		},
		apis: []unstructured.Unstructured{
			restAPI("dp-default-p70", "stale-target-http", "api-platform-default"),
			restAPI("dp-default-p70", "unlabelled-http", ""),
			restAPI("dp-default-p70", "served-http", "api-platform-default-development"),
		},
	})
	if len(r.Faults) != 2 {
		t.Fatalf("expected the stale and the unlabelled RestApi reported, got %q", r.Faults)
	}
	if !strings.Contains(r.Faults[0], "stale-target-http") || !strings.Contains(r.Faults[0], `"api-platform-default"`) || !strings.Contains(r.Faults[0], "nothing serves it") {
		t.Fatalf("fault should name the RestApi and the label it carries, got %q", r.Faults[0])
	}
	if !strings.Contains(r.Faults[1], "unlabelled-http") || !strings.Contains(r.Faults[1], `""`) {
		t.Fatalf("fault should show the missing label, got %q", r.Faults[1])
	}
}

func TestBuildGatewayReport_TwoGatewaysOnOneLabelIsAFault(t *testing.T) {
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{
			labelGateway("default-development", "api-platform-default-development", "api-platform-default-development", "Ready"),
			labelGateway("default-development", "ai-gateway-default-development", "api-platform-default-development", "Ready"),
		},
		apis: []unstructured.Unstructured{
			restAPI("dp-default-p70", "p70-hello-api-http", "api-platform-default-development"),
		},
	})
	if len(r.Faults) != 1 || !strings.Contains(r.Faults[0], "2 gateways") {
		t.Fatalf("expected the doubly selected RestApi reported once, got %q", r.Faults)
	}
}

func TestBuildGatewayReport_NamespacedGatewaySelectsItsNamespaces(t *testing.T) {
	own := gatewayObject("team-a", "team-a-gw", "Ready", map[string]interface{}{"scope": string(scopeNamespaced)})
	named := gatewayObject("default-development", "shared-gw", "Ready", map[string]interface{}{
		"scope": string(scopeNamespaced), "namespaces": []interface{}{"team-b", "team-c"},
	})
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{own, named},
		apis: []unstructured.Unstructured{
			restAPI("team-a", "a-http", ""),
			restAPI("team-c", "c-http", ""),
			restAPI("team-d", "d-http", ""),
		},
	})
	if len(r.Faults) != 1 || !strings.Contains(r.Faults[0], "team-d/d-http") {
		t.Fatalf("expected only the RestApi outside both namespace sets reported, got %q", r.Faults)
	}
}

func TestBuildGatewayReport_MatchExpressionsCount(t *testing.T) {
	gw := gatewayObject("default-development", "expr-gw", "Ready", map[string]interface{}{
		"scope": string(scopeLabel),
		"matchExpressions": []interface{}{map[string]interface{}{
			"key": restAPITargetLabel, "operator": "In", "values": []interface{}{"expr-gw"},
		}},
	})
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{gw},
		apis:     []unstructured.Unstructured{restAPI("dp-default-p70", "p70-hello-api-http", "expr-gw")},
	})
	if len(r.Faults) != 0 {
		t.Fatalf("a matchExpressions selector should select the RestApi, got %q", r.Faults)
	}
}

func TestBuildGatewayReport_UnknownScopeIsNamed(t *testing.T) {
	gw := gatewayObject("default-development", "odd-gw", "Ready", map[string]interface{}{"scope": "Regional"})
	r := mustReport(t, &fakeAPIPlatform{
		gateways: []unstructured.Unstructured{gw},
		apis:     []unstructured.Unstructured{restAPI("dp-default-p70", "p70-hello-api-http", "odd-gw")},
	})
	if len(r.Faults) != 2 || !strings.Contains(r.Faults[0], `scope "Regional"`) {
		t.Fatalf("an unknown scope must be reported by name, not swallowed, got %q", r.Faults)
	}
}

func TestBuildGatewayReport_NoGatewaysIsNotAnError(t *testing.T) {
	r := mustReport(t, &fakeAPIPlatform{})
	if len(r.Gateways) != 0 || len(r.Faults) != 0 {
		t.Fatalf("expected an empty report, got %+v", r)
	}
}

func TestBuildGatewayReport_ListErrorIsReturned(t *testing.T) {
	_, err := buildGatewayReport(context.Background(), &fakeAPIPlatform{err: errors.New("no matches for kind APIGateway")})
	if err == nil {
		t.Fatal("expected the list error to surface")
	}
}
