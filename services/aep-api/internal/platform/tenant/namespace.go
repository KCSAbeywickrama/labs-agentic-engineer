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

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// OrgBaseNamespace returns the org's base namespace name matching
// wso2cloud's `ou.util.GenerateNamespaceName` (= the same shape
// secret-manager-api derives server-side from the JWT's orgUUID claim):
//
//	wc-<first-8-chars-of-cleaned-uuid>-<8-char-sha256-hex>
//
// SM-API uses this as the namespace it writes SecretReference CRs into;
// the BFF must compute the same value when reconstructing the Vault
// path for ExternalSecret.spec.data[].remoteRef.key (Vault path shape:
// `<vaultPathPrefix>/<orgNS>/<secretRefName>`). Deterministic — same
// orgUUID always produces the same name.
//
// Home rationale (§4.0/§6.10c): this `wc-` derivation is a pure, gorm-free
// tenancy primitive consumed by the credentials domain (the SM-API
// SecretReference writer and the OpenBao provider's vault-path builder). It
// lives here in platform/tenant so no feature has to import another for it —
// the only genuine parallel implementation is the external cloud SM-API + the
// local stub, reconciled by a byte-parity contract test (§8), not a shared
// import.
func OrgBaseNamespace(orgUUID string) string {
	clean := strings.ReplaceAll(orgUUID, "-", "")
	prefix := clean
	if len(clean) > 8 {
		prefix = clean[:8]
	}
	hash := sha256.Sum256([]byte(orgUUID))
	salt := hex.EncodeToString(hash[:])[:8]
	return fmt.Sprintf("wc-%s-%s", strings.ToLower(prefix), salt)
}
