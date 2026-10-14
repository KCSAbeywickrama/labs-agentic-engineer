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
	"fmt"
	"slices"
	"sort"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"

	"github.com/wso2/aep/aectl/internal/ui"
)

// The API Platform gateway-operator's served API. v1 is the CRD's storage
// version on gateway-operator 0.11.0; the install check in
// platform_apiplatform.go probes v1alpha1, which the same CRD still serves. A
// RestApi names its gateway through restAPITargetLabel, which the
// api-configuration trait stamps with `api-platform-<org>-<env>`.
const (
	apiPlatformGatewayAPIVersion = "gateway.api-platform.wso2.com/v1"
	restAPITargetLabel           = "gateway.api-platform.wso2.com/restapi-target"
)

// apiSelectorScope is an APIGateway's spec.apiSelector.scope: which RestApi
// CRs the operator programs onto it.
type apiSelectorScope string

const (
	scopeCluster    apiSelectorScope = "Cluster"       // every RestApi in the cluster
	scopeNamespaced apiSelectorScope = "Namespaced"    // the ones in named namespaces, or its own
	scopeLabel      apiSelectorScope = "LabelSelector" // the ones a label selector matches
)

// apiPlatformLister lists APIGateways and RestApis (k8s.Applier).
type apiPlatformLister interface {
	List(ctx context.Context, apiVersion, kind, namespace string) ([]unstructured.Unstructured, error)
}

// gatewayRow is one APIGateway as `platform status` tables it.
type gatewayRow struct {
	Namespace, Name string
	Scope           apiSelectorScope
	Phase           string
}

// gatewayReport is what `platform status` says under Gateways: every
// APIGateway, and the routing faults no controller reports. Each presents as a
// healthy-looking RestApi CR and a 404 from the gateway its label names:
//
//   - a Cluster-scoped gateway claims every RestApi in the cluster, and the
//     operator programs a RestApi two gateways match onto one of them without a
//     word (deployments/design/agent-manager-convergence.md, the APIGateway row);
//   - a RestApi no other gateway selects is served by nothing, or only by that
//     Cluster-scoped one;
//   - a RestApi two other gateways select is programmed onto one of them.
type gatewayReport struct {
	Gateways []gatewayRow
	Faults   []string
}

// gateway is one APIGateway as the check reads it: the row the table shows and
// the selector the operator matches RestApis with.
type gateway struct {
	gatewayRow
	namespaces []string        // Namespaced: the gateway's own when the spec names none
	labels     labels.Selector // LabelSelector: matchLabels and matchExpressions
}

// readGateway lifts the row and spec.apiSelector off one object. The label
// half is parsed by the apimachinery selector so matchExpressions count too;
// an empty selector matches everything, as it does for the operator.
func readGateway(obj unstructured.Unstructured) (gateway, error) {
	scope, _, _ := unstructured.NestedString(obj.Object, "spec", "apiSelector", "scope")
	phase, _, _ := unstructured.NestedString(obj.Object, "status", "phase")
	g := gateway{gatewayRow: gatewayRow{obj.GetNamespace(), obj.GetName(), apiSelectorScope(scope), phase}}
	raw, _, _ := unstructured.NestedMap(obj.Object, "spec", "apiSelector")
	switch g.Scope {
	case scopeNamespaced:
		g.namespaces, _, _ = unstructured.NestedStringSlice(raw, "namespaces")
		if len(g.namespaces) == 0 {
			g.namespaces = []string{obj.GetNamespace()}
		}
	case scopeLabel:
		var ls metav1.LabelSelector
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &ls); err != nil {
			return g, fmt.Errorf("read apiSelector: %w", err)
		}
		parsed, err := metav1.LabelSelectorAsSelector(&ls)
		if err != nil {
			return g, fmt.Errorf("parse apiSelector: %w", err)
		}
		g.labels = parsed
	}
	return g, nil
}

// selects reports whether a Namespaced or LabelSelector gateway matches api.
func (g gateway) selects(api unstructured.Unstructured) bool {
	switch g.Scope {
	case scopeNamespaced:
		return slices.Contains(g.namespaces, api.GetNamespace())
	case scopeLabel:
		return g.labels.Matches(labels.Set(api.GetLabels()))
	default:
		return false
	}
}

func buildGatewayReport(ctx context.Context, lister apiPlatformLister) (gatewayReport, error) {
	objects, err := lister.List(ctx, apiPlatformGatewayAPIVersion, "APIGateway", "")
	if err != nil {
		return gatewayReport{}, fmt.Errorf("list APIGateways: %w", err)
	}
	apis, err := lister.List(ctx, apiPlatformGatewayAPIVersion, "RestApi", "")
	if err != nil {
		return gatewayReport{}, fmt.Errorf("list RestApis: %w", err)
	}

	var report gatewayReport
	var selecting []gateway // the gateways a RestApi is matched against
	var clusterScoped []string
	for _, obj := range objects {
		g, err := readGateway(obj)
		if err != nil {
			return gatewayReport{}, fmt.Errorf("APIGateway %s/%s: %w", obj.GetNamespace(), obj.GetName(), err)
		}
		report.Gateways = append(report.Gateways, g.gatewayRow)
		switch g.Scope {
		case scopeCluster:
			clusterScoped = append(clusterScoped, g.Name)
			report.Faults = append(report.Faults, fmt.Sprintf(
				"%s/%s selects scope: Cluster — it contends for all %d RestApis in the cluster; the operator programs each onto one gateway silently, and the ones it takes 404 on the gateway their label names",
				g.Namespace, g.Name, len(apis)))
		case scopeNamespaced, scopeLabel:
			selecting = append(selecting, g)
		default:
			report.Faults = append(report.Faults, fmt.Sprintf(
				"%s/%s selects scope %q, which this check does not know — its RestApis are not accounted for below",
				g.Namespace, g.Name, string(g.Scope)))
		}
	}
	sort.Slice(report.Gateways, func(i, j int) bool {
		a, b := report.Gateways[i], report.Gateways[j]
		if a.Namespace != b.Namespace {
			return a.Namespace < b.Namespace
		}
		return a.Name < b.Name
	})

	unserved := "nothing serves it"
	if len(clusterScoped) > 0 {
		unserved = "only the Cluster-scoped " + strings.Join(clusterScoped, ", ") + " can serve it"
	}
	for _, api := range apis {
		var matched []string
		for _, g := range selecting {
			if g.selects(api) {
				matched = append(matched, g.Name)
			}
		}
		switch len(matched) {
		case 1:
		case 0:
			report.Faults = append(report.Faults, fmt.Sprintf(
				"%s/%s is selected by no gateway (%s=%q) — %s",
				api.GetNamespace(), api.GetName(), restAPITargetLabel, api.GetLabels()[restAPITargetLabel], unserved))
		default:
			report.Faults = append(report.Faults, fmt.Sprintf(
				"%s/%s is selected by %d gateways (%s) — the operator programs it onto one of them silently",
				api.GetNamespace(), api.GetName(), len(matched), strings.Join(matched, ", ")))
		}
	}
	return report, nil
}

// printGatewayReport renders the Gateways section of `platform status`.
func printGatewayReport(r gatewayReport) {
	if len(r.Gateways) == 0 {
		ui.Detail("no APIGateway found")
	} else {
		t := ui.NewTable("NAMESPACE", "NAME", "SCOPE", "PHASE")
		for _, g := range r.Gateways {
			t.AddRow(g.Namespace, g.Name, colorSelectorScope(g.Scope), colorGatewayPhase(g.Phase))
		}
		t.Print()
	}
	for _, f := range r.Faults {
		fmt.Printf("  %s %s\n", ui.Red("✗"), f)
	}
}

func colorSelectorScope(scope apiSelectorScope) string {
	switch scope {
	case scopeLabel, scopeNamespaced:
		return ui.Green(string(scope))
	case scopeCluster:
		return ui.Red(string(scope))
	default:
		return ui.Yellow(string(scope))
	}
}

func colorGatewayPhase(phase string) string {
	switch phase {
	case "Ready":
		return ui.Green(phase)
	case "":
		return ui.Yellow("unknown")
	default:
		return ui.Yellow(phase)
	}
}
