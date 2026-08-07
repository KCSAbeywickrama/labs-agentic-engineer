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

// retirement_test.go holds the invariants that lock the retired dispatch model
// out of the tree. Coding-agent cycles are OpenChoreo Components created
// through the OC API; aep-api reaches no cluster any other way. These tests are
// the reason a future session cannot quietly reintroduce a Kubernetes client or
// a cluster-gateway-proxy call — the boundary is executable, not documented.
package arch

import "testing"

// TestCodingAgentDispatchesOnlyThroughOpenChoreo asserts the delivery/codingagent
// package holds no DIRECT edge to the cluster-gateway-proxy client or to a
// controller-runtime Kubernetes client. Direct (not transitive) is the right
// granularity here: sibling domains may still legitimately import packages that
// this one must not touch itself.
func TestCodingAgentDispatchesOnlyThroughOpenChoreo(t *testing.T) {
	const pkg = mod + "/internal/delivery/codingagent"
	banned := map[string]string{
		mod + "/internal/clients/clustergatewayproxy": "cycle dispatch and log reads go through the OpenChoreo API; the proxy path is retired",
		"sigs.k8s.io/controller-runtime/pkg/client":   "OpenChoreo renders the cycle Job; aep-api never talks to a Kubernetes API itself",
	}
	for _, imp := range directImports(t, pkg) {
		if why, bad := banned[imp]; bad {
			t.Errorf("delivery/codingagent imports %s — %s", imp, why)
		}
	}
}
