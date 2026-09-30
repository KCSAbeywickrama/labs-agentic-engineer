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

package genaiturns

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
)

// The scope on a create-turn request (S6): what the user was looking at when
// they sent it — a feature's file, or the design review. Absent means the whole
// product. A scope focuses the turn and fences nothing, so the only thing
// checked here is that it names something the agents service can act on.

var featureIDPattern = regexp.MustCompile(`^F[0-9]+$`)

// scopeFromJSON converts the generated request field into the agents-service
// wire block, or nil when the turn carries no scope.
func scopeFromJSON(scope gen.TurnScope) (*agentsvc.ScopeBlock, error) {
	switch scope.Kind {
	case "":
		if scope.Feature != "" {
			return nil, apierr.BadRequest("scope.kind is required")
		}
		return nil, nil
	case gen.Feature:
		if !featureIDPattern.MatchString(scope.Feature) {
			return nil, apierr.BadRequest("scope.feature must be a feature ID such as F2")
		}
		return &agentsvc.ScopeBlock{Kind: string(scope.Kind), Feature: scope.Feature}, nil
	case gen.DesignReview:
		if scope.Feature != "" {
			return nil, apierr.BadRequest("scope.feature is only for a feature scope")
		}
		return &agentsvc.ScopeBlock{Kind: string(scope.Kind)}, nil
	default:
		return nil, apierr.BadRequest("scope.kind must be feature or design-review")
	}
}

// parseScopeField decodes the multipart `scope` part, which the contract
// declares `application/json`, as it does `anchor`.
func parseScopeField(raw string) (gen.TurnScope, error) {
	var scope gen.TurnScope
	if strings.TrimSpace(raw) == "" {
		return scope, nil
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&scope); err != nil {
		return scope, apierr.BadRequest("scope must be valid JSON: {kind, feature?}")
	}
	return scope, nil
}
