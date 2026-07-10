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

package resources

import (
	"regexp"
	"testing"
)

func TestExternalResourceNaming(t *testing.T) {
	t.Parallel()

	if got := ExternalResourceName("weatherproj", "openweather"); got != "weatherproj-openweather" {
		t.Errorf("ExternalResourceName = %q", got)
	}
	if got := ExternalResourceBindingName("weatherproj", "openweather", "development"); got != "weatherproj-openweather-development" {
		t.Errorf("ExternalResourceBindingName = %q", got)
	}
}

// dns1035 is the label form OpenChoreo renders a binding into and CloudNativePG
// validates a Cluster name against: lowercase, starts with a letter, ends
// alphanumeric, only [a-z0-9-] between. The bound name MUST stay in this form.
var dns1035 = regexp.MustCompile(`^[a-z]([-a-z0-9]*[a-z0-9])?$`)

// TestExternalResourceBindingName_BoundsForCNPG pins the fix for the
// cluster-name overflow (#165): OC renders a binding into a backing object named
// r-<bindingName>-<hash8> (+11 chars) and CloudNativePG hard-caps a Cluster name
// at 50, so a binding name must stay <= 38. A short name is returned verbatim;
// an overflowing name is truncated with a deterministic hash tail that keeps it
// unique, stable, and a valid DNS-1035 label.
func TestExternalResourceBindingName_BoundsForCNPG(t *testing.T) {
	t.Parallel()

	// Short names pass through unchanged (existing bindings keep readable names).
	if got := ExternalResourceBindingName("aeh", "aeh-db", "development"); got != "aeh-aeh-db-development" {
		t.Errorf("short name should be verbatim, got %q", got)
	}

	// The real overflow case: project + a project-prefixed dep + env = 44 chars,
	// which rendered to a 55-char CNPG Cluster name and was rejected.
	long := ExternalResourceBindingName("audit-evidence", "audit-evidence-db", "development")
	if len(long) > maxOCBindingName {
		t.Errorf("bounded name len = %d, want <= %d (%q)", len(long), maxOCBindingName, long)
	}
	if renderLen := len("r-") + len(long) + len("-") + 8; renderLen > cnpgMaxClusterName {
		t.Errorf("OC-rendered cluster name would be %d chars, want <= %d", renderLen, cnpgMaxClusterName)
	}
	if !dns1035.MatchString(long) {
		t.Errorf("bounded name %q is not a valid DNS-1035 label", long)
	}

	// Stable: same inputs -> same output (deprovision/status must recompute it).
	if again := ExternalResourceBindingName("audit-evidence", "audit-evidence-db", "development"); again != long {
		t.Errorf("not stable: %q != %q", again, long)
	}

	// Unique: a different env (same project/dep) and a different dep must not
	// collide after truncation — the hash covers the full natural name.
	prod := ExternalResourceBindingName("audit-evidence", "audit-evidence-db", "production")
	other := ExternalResourceBindingName("audit-evidence", "audit-evidence-logs-store", "development")
	if prod == long {
		t.Errorf("dev and prod bindings collided: %q", long)
	}
	if other == long {
		t.Errorf("distinct deps collided after truncation: %q", long)
	}
}
