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

package agents

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The architect request's additive `mcp` block: injected by the client at
// send time when both the MCP URL and a token issuer are configured, omitted
// otherwise, and dropped (never fatal) when the mint fails.

// captureArchitect drives one StreamArchitect call against the capture server
// the client points at; the payload is then read from the server's capture map.
func captureArchitect(t *testing.T, c Client, orgID string) {
	t.Helper()
	rc, err := c.StreamArchitect(t.Context(), orgID, ArchitectRequest{ProjectName: "shop", Spec: "spec"})
	if err != nil {
		t.Fatalf("StreamArchitect: %v", err)
	}
	defer rc.Close()
	_, _ = io.ReadAll(rc)
}

func newCaptureServer(t *testing.T) (*httptest.Server, *map[string]json.RawMessage) {
	t.Helper()
	captured := map[string]json.RawMessage{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Errorf("unmarshal architect payload: %v", err)
		}
		for k, v := range payload {
			captured[k] = v
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, &captured
}

func TestStreamArchitect_AttachesMCPBinding(t *testing.T) {
	srv, captured := newCaptureServer(t)
	c := NewClient(srv.URL, nil, nil, "http://aep-api:8080/internal/v1/mcp",
		func(orgID string) (string, error) {
			if orgID != "org-1" {
				t.Errorf("issuer orgID = %q, want org-1", orgID)
			}
			return "signed-token", nil
		})
	captureArchitect(t, c, "org-1")

	raw, ok := (*captured)["mcp"]
	if !ok {
		t.Fatalf("architect payload missing mcp block: %v", *captured)
	}
	var mcp MCPBinding
	if err := json.Unmarshal(raw, &mcp); err != nil {
		t.Fatalf("unmarshal mcp: %v", err)
	}
	if mcp.URL != "http://aep-api:8080/internal/v1/mcp" || mcp.Token != "signed-token" {
		t.Errorf("mcp = %+v, want the configured URL + minted token", mcp)
	}
}

func TestStreamArchitect_NoMCPConfigured_OmitsBlock(t *testing.T) {
	srv, captured := newCaptureServer(t)
	c := NewClient(srv.URL, nil, nil, "", nil)
	captureArchitect(t, c, "org-1")

	if _, ok := (*captured)["mcp"]; ok {
		t.Fatalf("architect payload carries mcp with no MCP configured: %v", *captured)
	}
}

func TestStreamArchitect_MintFailure_OmitsBlockNotFatal(t *testing.T) {
	srv, captured := newCaptureServer(t)
	c := NewClient(srv.URL, nil, nil, "http://aep-api:8080/internal/v1/mcp",
		func(string) (string, error) { return "", errors.New("boom") })
	// Must still stream (captureArchitect fails the test on error).
	captureArchitect(t, c, "org-1")

	if _, ok := (*captured)["mcp"]; ok {
		t.Fatalf("architect payload carries mcp despite mint failure: %v", *captured)
	}
}
