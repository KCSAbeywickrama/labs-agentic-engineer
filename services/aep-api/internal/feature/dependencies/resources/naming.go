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
	"fmt"
	"hash/fnv"
	"strings"
)

const (
	// cnpgMaxClusterName is CloudNativePG's hard cap on a Cluster metadata.name
	// (kubectl-verified: "the maximum length of a cluster name is 50 characters").
	// It is the strictest length limit any platform-resource backing store
	// imposes, so it governs the bound for every OC binding name.
	cnpgMaxClusterName = 50
	// ocRenderDecoration is the fixed overhead OpenChoreo adds when it renders a
	// ResourceReleaseBinding into a backing object: it names that object
	// r-<bindingName>-<hash>, i.e. "r-" (2) + "-" (1) + an 8-char content hash =
	// 11 chars (observed on OC 1.1.1). One extra char guards against a wider hash.
	ocRenderDecoration = 11 + 1
	// maxOCBindingName is the longest a binding metadata.name may be so its
	// OC-rendered backing object stays within cnpgMaxClusterName. Longer names
	// are hash-truncated by boundName.
	maxOCBindingName = cnpgMaxClusterName - ocRenderDecoration // 38
)

// boundName returns natural unchanged when it already fits max; otherwise it
// replaces the overflowing tail with a deterministic 8-hex FNV-1a hash of the
// FULL natural name. The hash makes collisions between distinct long names
// negligible (a 32-bit space against per-org resource cardinality) rather than
// the near-certain prefix collision a plain truncation would cause, while the
// result stays a valid DNS-1035 label (lowercase, starts with a letter, no
// trailing '-') within max. Short names are returned byte-for-byte, so existing
// bindings keep their readable names and only overflowing names change — no
// migration of already provisioned resources is needed.
func boundName(natural string, max int) string {
	if len(natural) <= max {
		return natural
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(natural))
	suffix := fmt.Sprintf("-%08x", h.Sum32()) // 9 chars: '-' + 8 hex
	head := strings.TrimRight(natural[:max-len(suffix)], "-")
	return head + suffix
}

// EnvVarName builds a valid C_IDENTIFIER env-var name from a dependency name +
// output name (join with "_", map every char outside [A-Za-z0-9_] to '_',
// upper-case). It is the SINGLE source of truth for the platform-resource
// output naming convention: the provisioning wiring (pod env-var injection in
// wiring.go) and the SPA runtime config (window._env_ keys in runtimeconfig)
// both derive their keys through it, so the coding agent and the browser see
// byte-identical names. e.g. "orders-db" + "host" → "ORDERS_DB_HOST";
// "user-auth" + "client_id" → "USER_AUTH_CLIENT_ID".
func EnvVarName(depName, outName string) string {
	joined := depName + "_" + outName
	mapped := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_':
			return r
		default:
			return '_'
		}
	}, joined)
	return strings.ToUpper(mapped)
}

// ExternalResourceName is the per-project OC Resource name (== the Workload
// dependency `ref`) for a project's external resource. metadata.name is
// namespace-unique — owner.projectName does NOT scope it — so the project
// prefixes the name. Exported: the dispatch-time consumer-dependency renderer
// derives the same name through this single source of truth.
func ExternalResourceName(project, name string) string { return project + "-" + name }

// ExternalResourceBindingName is the per-env ResourceReleaseBinding name an
// external resource's outputs are read from — and, since external and
// platform-resource bindings share one naming form, the name OC renders a
// platform-resource (e.g. a CloudNativePG Cluster) from. It is bounded to
// maxOCBindingName so that after OC's r-<name>-<hash> render decoration the
// backing object's name stays within CloudNativePG's 50-char Cluster-name cap
// (#165). Every read/write of a binding name routes through here, so the bound
// is applied consistently across provision, deprovision, status, and consumer
// wiring.
func ExternalResourceBindingName(project, name, env string) string {
	return boundName(ExternalResourceName(project, name)+"-"+env, maxOCBindingName)
}
