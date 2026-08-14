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

package organization

import "time"

func derefString(p *string) string {
	if p != nil {
		return *p
	}
	return ""
}

// ResolvedSecretRefName returns secret_ref_name.
func (c *OrgAnthropicCredential) ResolvedSecretRefName() *string {
	return c.SecretRefName
}

// ResolvedSecretRefKVPath returns secret_ref_kv_path.
func (c *OrgAnthropicCredential) ResolvedSecretRefKVPath() *string {
	return c.SecretRefKVPath
}

// ResolvedSecretRefProperty returns secret_ref_property.
func (c *OrgAnthropicCredential) ResolvedSecretRefProperty() *string {
	return c.SecretRefProperty
}

// ResolvedSecretRefName returns secret_ref_name.
func (c *OrgCredential) ResolvedSecretRefName() *string {
	return c.SecretRefName
}

// ResolvedSecretRefKVPath returns secret_ref_kv_path.
func (c *OrgCredential) ResolvedSecretRefKVPath() *string {
	return c.SecretRefKVPath
}

// ResolvedSecretRefProperty returns secret_ref_property.
func (c *OrgCredential) ResolvedSecretRefProperty() *string {
	return c.SecretRefProperty
}

// ResolvedSecretRefWrittenAt returns secret_ref_written_at.
func (c *OrgCredential) ResolvedSecretRefWrittenAt() *time.Time {
	return c.SecretRefWrittenAt
}

// ResolvedSecretRefName returns secret_ref_name.
func (p *OrganizationIDPProfile) ResolvedSecretRefName() *string {
	return p.SecretRefName
}

// ResolvedSecretRefKVPath returns secret_ref_kv_path.
func (p *OrganizationIDPProfile) ResolvedSecretRefKVPath() *string {
	return p.SecretRefKVPath
}

// ResolvedSecretRefProperty returns secret_ref_property.
func (p *OrganizationIDPProfile) ResolvedSecretRefProperty() *string {
	return p.SecretRefProperty
}

// ResolvedSecretRefWrittenAt returns secret_ref_written_at.
func (p *OrganizationIDPProfile) ResolvedSecretRefWrittenAt() *time.Time {
	return p.SecretRefWrittenAt
}

// stampSecretRefTriplet returns UpdateColumns keys for the secret_ref_* columns.
func stampSecretRefTriplet(secretRefName, vaultKey, prop string) map[string]any {
	return map[string]any{
		"secret_ref_name":     secretRefName,
		"secret_ref_kv_path":  vaultKey,
		"secret_ref_property": prop,
	}
}

// stampSecretRefTripletWithWrittenAt is stampSecretRefTriplet plus written_at
// (org_credentials / organization_idp_profiles).
func stampSecretRefTripletWithWrittenAt(secretRefName, vaultKey, prop string, writtenAt time.Time) map[string]any {
	m := stampSecretRefTriplet(secretRefName, vaultKey, prop)
	m["secret_ref_written_at"] = writtenAt
	return m
}

func clearSecretRefTriplet() map[string]any {
	return map[string]any{
		"secret_ref_name":     nil,
		"secret_ref_kv_path":  nil,
		"secret_ref_property": nil,
	}
}

func clearSecretRefTripletWithWrittenAt() map[string]any {
	m := clearSecretRefTriplet()
	m["secret_ref_written_at"] = nil
	return m
}
