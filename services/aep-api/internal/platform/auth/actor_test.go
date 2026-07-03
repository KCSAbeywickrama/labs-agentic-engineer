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

package auth

import (
	"context"
	"testing"
)

func TestActorFromContext(t *testing.T) {
	cases := []struct {
		name string
		ctx  context.Context
		want string
	}{
		{"verified subject", WithClaims(context.Background(), &Claims{Subject: "user-123"}), "user-123"},
		{"no claims", context.Background(), "unknown"},
		{"empty subject", WithClaims(context.Background(), &Claims{}), "unknown"},
		{"nil claims", WithClaims(context.Background(), nil), "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ActorFromContext(tc.ctx); got != tc.want {
				t.Fatalf("ActorFromContext() = %q, want %q", got, tc.want)
			}
		})
	}
}
