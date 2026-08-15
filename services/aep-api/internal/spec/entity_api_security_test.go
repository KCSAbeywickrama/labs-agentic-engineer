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

package spec

import "testing"

func TestResolveAPISecurityEnabled(t *testing.T) {
	cases := []struct {
		name    string
		exposes *ExposesAPI
		want    bool
	}{
		{"nil block", nil, false},
		{"empty auth", &ExposesAPI{Auth: ""}, false},
		{"none", &ExposesAPI{Auth: "none"}, false},
		{"end-user-required", &ExposesAPI{Auth: "end-user-required"}, true},
		{"service-required", &ExposesAPI{Auth: "service-required"}, true},
		{"whitespace tolerant", &ExposesAPI{Auth: "  end-user-required  "}, true},
		{"unrecognised value defensive false", &ExposesAPI{Auth: "yes"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ResolveAPISecurityEnabled(DesignComponent{ExposesAPI: c.exposes})
			if got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestResolveAPISecurityCallerKind(t *testing.T) {
	cases := []struct {
		name    string
		exposes *ExposesAPI
		want    string
	}{
		{"nil block", nil, ""},
		{"none", &ExposesAPI{Auth: "none"}, ""},
		{"end-user-required", &ExposesAPI{Auth: "end-user-required"}, "end-user"},
		{"service-required", &ExposesAPI{Auth: "service-required"}, "service"},
		{"unrecognised", &ExposesAPI{Auth: "yes"}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ResolveAPISecurityCallerKind(DesignComponent{ExposesAPI: c.exposes})
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

// IsGatewayProtectableType is the shared answer to "can a component of this
// type sit behind the API Platform Gateway at all?". Both consumers key on it
// — the design-save stamp and the trait emitter — so a wrong answer here
// desynchronises them, which is the specific failure of a design that claims
// protection it never receives.
func TestIsGatewayProtectableType(t *testing.T) {
	t.Parallel()
	cases := []struct {
		componentType string
		want          bool
	}{
		{ComponentTypeService, true},
		// An agent a SPA calls is a protected backend on the same terms.
		{ComponentTypeAIAgent, true},
		// A SPA obtains the token; it never presents one to a gateway.
		{ComponentTypeWebApplication, false},
		{"", false},
		{"database", false},
	}
	for _, c := range cases {
		t.Run(c.componentType, func(t *testing.T) {
			if got := IsGatewayProtectableType(c.componentType); got != c.want {
				t.Fatalf("IsGatewayProtectableType(%q) = %v, want %v", c.componentType, got, c.want)
			}
		})
	}
}
