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
	"strings"
	"testing"
)

// TestTryItOverridesSetsBoth is the case every re-domained install takes: the
// Try-it app moves off *.ae.localhost with the rest of the platform, and its
// allowlist follows the data-plane gateway the components are published on.
func TestTryItOverridesSetsBoth(t *testing.T) {
	got := tryItOverrides("http://tryit.ae.10.0.0.5.sslip.io:8080", "openchoreoapis.10.0.0.5.sslip.io")

	want := []string{
		"--set", "tryIt.publicURL=http://tryit.ae.10.0.0.5.sslip.io:8080",
		"--set", "tryIt.gatewayHosts=openchoreoapis.10.0.0.5.sslip.io",
	}
	if len(got) != len(want) {
		t.Fatalf("tryItOverrides returned %d args, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("arg %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestTryItOverridesEmptyGatewayHostname covers the cluster whose gateway
// ingress was configured by hand, with nothing in config to read it from.
// The URL still moves; the allowlist is left at the chart's default rather
// than invented.
func TestTryItOverridesEmptyGatewayHostname(t *testing.T) {
	got := tryItOverrides("http://tryit.ae.example.com:8080", "")

	joined := strings.Join(got, " ")
	if !strings.Contains(joined, "tryIt.publicURL=http://tryit.ae.example.com:8080") {
		t.Errorf("publicURL override missing from %q", joined)
	}
	if strings.Contains(joined, "tryIt.gatewayHosts") {
		t.Errorf("unexpected gatewayHosts override in %q: an empty hostname must leave the chart default", joined)
	}
}

// TestTryItOverridesEmpty asserts the function adds nothing when it is given
// nothing — the chart's own values stand, exactly as before this existed.
func TestTryItOverridesEmpty(t *testing.T) {
	if got := tryItOverrides("", ""); len(got) != 0 {
		t.Errorf("tryItOverrides(\"\", \"\") = %v, want no args", got)
	}
}
