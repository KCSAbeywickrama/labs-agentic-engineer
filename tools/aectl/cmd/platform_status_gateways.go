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

// The API Platform gateway-operator's served API. An APIGateway's apiSelector
// decides which RestApi CRs the operator programs onto it — every one in the
// cluster (Cluster), the ones in named namespaces or its own (Namespaced), or
// the ones a label selector matches (LabelSelector). A RestApi names its
// gateway through restAPITargetLabel, which the api-configuration trait stamps
// with `api-platform-<org>-<env>`.
const (
	apiPlatformGatewayAPIVersion = "gateway.api-platform.wso2.com/v1"
	restAPITargetLabel           = "gateway.api-platform.wso2.com/restapi-target"
	apiSelectorScopeCluster      = "Cluster"
	apiSelectorScopeNamespaced   = "Namespaced"
	apiSelectorScopeLabel        = "LabelSelector"
)

// apiPlatformLister lists APIGateways and RestApis (k8s.Applier).
type apiPlatformLister interface {
	List(ctx context.Context, apiVersion, kind, namespace string) ([]unstructured.Unstructured, error)
}

// gatewayRow is one APIGateway as `platform status` tables it.
type gatewayRow struct {
	Namespace, Name, Scope, Phase string
}

// gatewayReport is what `platform status` says under Gateways: every
// APIGateway, and the routing faults no controller reports. Each presents as a
// healthy-looking RestApi CR and a 404 from the gateway its label names:
//
//   - a Cluster-scoped gateway claims every RestApi in the cluster, and the
//     operator programs a RestApi two gateways match onto one of them without a
//     word (deployments/design/agent-manager-convergence.md, the APIGateway row);
//   - a RestApi no other gateway selects is served by nothing;
//   - a RestApi two other gateways select is programmed onto one of them.
type gatewayReport struct {
	Gateways []gatewayRow
	Faults   []string
}

// gatewaySelector is one non-Cluster APIGateway's apiSelector, ready to ask
// whether it selects a RestApi.
type gatewaySelector struct {
	name       string
	scope      string
	namespaces []string        // Namespaced: the gateway's own when the spec names none
	labels     labels.Selector // LabelSelector: matchLabels and matchExpressions
}

func (s gatewaySelector) selects(api unstructured.Unstructured) bool {
	switch s.scope {
	case apiSelectorScopeNamespaced:
		return slices.Contains(s.namespaces, api.GetNamespace())
	case apiSelectorScopeLabel:
		return s.labels.Matches(labels.Set(api.GetLabels()))
	default:
		return false
	}
}

func buildGatewayReport(ctx context.Context, lister apiPlatformLister) (gatewayReport, error) {
	gateways, err := lister.List(ctx, apiPlatformGatewayAPIVersion, "APIGateway", "")
	if err != nil {
		return gatewayReport{}, fmt.Errorf("list APIGateways: %w", err)
	}
	apis, err := lister.List(ctx, apiPlatformGatewayAPIVersion, "RestApi", "")
	if err != nil {
		return gatewayReport{}, fmt.Errorf("list RestApis: %w", err)
	}

	var report gatewayReport
	var selectors []gatewaySelector
	for _, gw := range gateways {
		scope, _, _ := unstructured.NestedString(gw.Object, "spec", "apiSelector", "scope")
		phase, _, _ := unstructured.NestedString(gw.Object, "status", "phase")
		report.Gateways = append(report.Gateways, gatewayRow{gw.GetNamespace(), gw.GetName(), scope, phase})
		if scope == apiSelectorScopeCluster {
			report.Faults = append(report.Faults, fmt.Sprintf(
				"%s/%s selects scope: Cluster — it contends for all %d RestApis in the cluster; the operator programs each onto one gateway silently, and the ones it takes 404 on the gateway their label names",
				gw.GetNamespace(), gw.GetName(), len(apis)))
			continue
		}
		sel, err := readGatewaySelector(gw, scope)
		if err != nil {
			return gatewayReport{}, fmt.Errorf("APIGateway %s/%s: %w", gw.GetNamespace(), gw.GetName(), err)
		}
		selectors = append(selectors, sel)
	}
	sort.Slice(report.Gateways, func(i, j int) bool {
		a, b := report.Gateways[i], report.Gateways[j]
		if a.Namespace != b.Namespace {
			return a.Namespace < b.Namespace
		}
		return a.Name < b.Name
	})

	for _, api := range apis {
		var matched []string
		for _, s := range selectors {
			if s.selects(api) {
				matched = append(matched, s.name)
			}
		}
		switch len(matched) {
		case 1:
		case 0:
			report.Faults = append(report.Faults, fmt.Sprintf(
				"%s/%s is selected by no gateway (%s=%q) — nothing serves it",
				api.GetNamespace(), api.GetName(), restAPITargetLabel, api.GetLabels()[restAPITargetLabel]))
		default:
			report.Faults = append(report.Faults, fmt.Sprintf(
				"%s/%s is selected by %d gateways (%s) — the operator programs it onto one of them silently",
				api.GetNamespace(), api.GetName(), len(matched), strings.Join(matched, ", ")))
		}
	}
	return report, nil
}

// readGatewaySelector lifts spec.apiSelector off a non-Cluster APIGateway. The
// label half is parsed by the apimachinery selector so matchExpressions count
// too; an empty selector matches everything, as it does for the operator.
func readGatewaySelector(gw unstructured.Unstructured, scope string) (gatewaySelector, error) {
	sel := gatewaySelector{name: gw.GetName(), scope: scope}
	raw, _, _ := unstructured.NestedMap(gw.Object, "spec", "apiSelector")
	switch scope {
	case apiSelectorScopeNamespaced:
		sel.namespaces, _, _ = unstructured.NestedStringSlice(raw, "namespaces")
		if len(sel.namespaces) == 0 {
			sel.namespaces = []string{gw.GetNamespace()}
		}
	case apiSelectorScopeLabel:
		var ls metav1.LabelSelector
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &ls); err != nil {
			return sel, fmt.Errorf("read apiSelector: %w", err)
		}
		parsed, err := metav1.LabelSelectorAsSelector(&ls)
		if err != nil {
			return sel, fmt.Errorf("parse apiSelector: %w", err)
		}
		sel.labels = parsed
	}
	return sel, nil
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

func colorSelectorScope(scope string) string {
	switch scope {
	case apiSelectorScopeLabel, apiSelectorScopeNamespaced:
		return ui.Green(scope)
	case apiSelectorScopeCluster:
		return ui.Red(scope)
	case "":
		return ui.Yellow("unset")
	default:
		return ui.Yellow(scope)
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
