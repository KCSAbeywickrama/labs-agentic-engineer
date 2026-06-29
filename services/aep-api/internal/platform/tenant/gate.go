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

package tenant

import "strings"

// GateMode controls whether the tenant gate enforces or only observes. With the
// active org now derived solely from the verified token (humakit.OrgScopedInput),
// the gate's only decision is whether a missing org claim denies (enforce) or
// passes through with a canary (log). Rollback from enforce is TENANT_GATE_MODE=log.
type GateMode string

const (
	GateModeLog     GateMode = "log"
	GateModeEnforce GateMode = "enforce"
)

// ParseGateMode reads TENANT_GATE_MODE. The gate is ENFORCE BY DEFAULT: only an
// explicit "log" (case-insensitive, whitespace-trimmed) selects observe-only
// mode; anything else — unset, "enforce", or an unrecognized value — enforces.
// This makes the secure posture the zero-config default (no env var needed in
// any environment, incl. cloud release bindings) and fail-secure on a typo.
func ParseGateMode(s string) GateMode {
	if strings.EqualFold(strings.TrimSpace(s), string(GateModeLog)) {
		return GateModeLog
	}
	return GateModeEnforce
}
