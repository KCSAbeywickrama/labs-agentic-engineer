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
	"reflect"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/gen"
)

func TestScopeFromJSON(t *testing.T) {
	cases := []struct {
		name    string
		in      gen.TurnScope
		want    *agentsvc.ScopeBlock
		wantErr bool
	}{
		{"absent is the whole product", gen.TurnScope{}, nil, false},
		{"a feature", gen.TurnScope{Kind: gen.Feature, Feature: "F12"}, &agentsvc.ScopeBlock{Kind: "feature", Feature: "F12"}, false},
		{"the design review", gen.TurnScope{Kind: gen.DesignReview}, &agentsvc.ScopeBlock{Kind: "design-review"}, false},
		{"a feature needs its ID", gen.TurnScope{Kind: gen.Feature}, nil, true},
		{"a story ID is not a feature", gen.TurnScope{Kind: gen.Feature, Feature: "F2.3"}, nil, true},
		{"a name is not a feature ID", gen.TurnScope{Kind: gen.Feature, Feature: "approvals"}, nil, true},
		{"the design review names no feature", gen.TurnScope{Kind: gen.DesignReview, Feature: "F2"}, nil, true},
		{"a feature without a kind", gen.TurnScope{Feature: "F2"}, nil, true},
		{"an unknown kind", gen.TurnScope{Kind: "product"}, nil, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := scopeFromJSON(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("scope = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// The multipart `scope` part is JSON, read strictly: a misspelt field is a
// 400, not a scope silently dropped.
func TestParseScopeField(t *testing.T) {
	got, err := parseScopeField(`{"kind":"feature","feature":"F2"}`)
	if err != nil || got.Kind != gen.Feature || got.Feature != "F2" {
		t.Fatalf("scope = %+v, err %v", got, err)
	}
	if got, err := parseScopeField("  "); err != nil || got.Kind != "" {
		t.Errorf("blank part = %+v, err %v; want no scope", got, err)
	}
	for _, raw := range []string{"not json", `{"kind":"feature","featur":"F2"}`} {
		if _, err := parseScopeField(raw); err == nil {
			t.Errorf("parseScopeField(%q) accepted", raw)
		}
	}
}
