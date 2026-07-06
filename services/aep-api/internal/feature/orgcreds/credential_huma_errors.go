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

// credential_huma_errors.go — mapCredentialError translates the credential
// services' typed errors (ValidationError / ConflictError / UpstreamError /
// NotFoundError) into RFC 9457 problem responses. The public org-scoped GitHub
// and Anthropic routes that once called it were consolidated into the /config
// surface (docs/design/org-config-consolidation.md), which maps the same error
// taxonomy to section-pointered problems via orgconfig.sectionErrorFrom; this
// mapper is retained as the unit-tested reference for that taxonomy.

package orgcreds

import (
	"errors"

	"github.com/danielgtaylor/huma/v2"
)

// mapCredentialError translates the typed errors returned by
// CredentialService / AnthropicCredentialService into RFC 9457 problem
// responses: 404 for NotFoundError, 409 for ConflictError, 400 for
// ValidationError, 502 for UpstreamError, 503 for ErrAppBindNotConfigured, 500
// otherwise. The structured cause of the TYPED errors is preserved so the
// console can render field-level text; an untyped error collapses to a fixed
// opaque 500 that never echoes the internal cause (matching project).
func mapCredentialError(err error) error {
	var nfe *NotFoundError
	if errors.As(err, &nfe) {
		return huma.Error404NotFound(err.Error())
	}
	var ce *ConflictError
	if errors.As(err, &ce) {
		return huma.Error409Conflict(err.Error())
	}
	var ve *ValidationError
	if errors.As(err, &ve) {
		return huma.Error400BadRequest(err.Error())
	}
	var ue *UpstreamError
	if errors.As(err, &ue) {
		return huma.Error502BadGateway(err.Error())
	}
	if errors.Is(err, ErrAppBindNotConfigured) {
		return huma.Error503ServiceUnavailable(err.Error())
	}
	return huma.Error500InternalServerError("internal error")
}
