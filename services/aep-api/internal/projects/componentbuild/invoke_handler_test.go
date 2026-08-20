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

package componentbuild

import (
	"context"
	"errors"
	"net/http"
	"testing"

	gen "github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/projects"
)

// The sentinel -> HTTP status map is a CROSS-LANGUAGE contract, not an
// internal detail: the console keys "this agent is not deployed yet" off 409
// and asserts it against a hand-built fixture. Nothing pinned the Go side, so
// changing 409 here would leave both suites green and silently break the Test
// tab. Each row below is one status the console (or a future client) reads.
type stubInvoker struct {
	projects.ComponentService // embedded, nil: any other method would panic rather than quietly answer
	err                       error
}

func (s stubInvoker) Invoke(context.Context, string, string, string, projects.InvokeCall, string) (projects.InvokeResult, error) {
	if s.err != nil {
		return projects.InvokeResult{}, s.err
	}
	return projects.InvokeResult{Status: 200, ContentType: "application/json", Body: []byte(`{"ok":true}`)}, nil
}

func TestInvokeComponent_SentinelToStatus(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{"not found", projects.ErrComponentNotFound, http.StatusNotFound},
		{"not reachable", projects.ErrNotReachable, http.StatusConflict},
		{"bad path", projects.ErrBadPath, http.StatusBadRequest},
		{"body too large", projects.ErrBodyTooLarge, http.StatusRequestEntityTooLarge},
		{"upstream timeout", projects.ErrUpstreamTimeout, http.StatusGatewayTimeout},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h := &Handler{comp: stubInvoker{err: tc.err}}
			ctx := tenant.WithBoundOrg(context.Background(), "acme")
			_, err := h.InvokeComponent(ctx, gen.InvokeComponentRequestObject{
				ProjectName:   "web",
				ComponentName: "chat-agent",
				Body:          &gen.InvokeRequest{Method: "POST", Path: "/chat"},
			})
			if err == nil {
				t.Fatalf("want an error for %v", tc.err)
			}
			var apiErr *apierr.Error
			if !errors.As(err, &apiErr) {
				t.Fatalf("want an *apierr.Error, got %T", err)
			}
			if apiErr.Status != tc.want {
				t.Fatalf("want status %d, got %d", tc.want, apiErr.Status)
			}
		})
	}
}
