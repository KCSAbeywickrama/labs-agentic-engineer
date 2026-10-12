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

package mcp

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"slices"

	"github.com/wso2/aep/ae-studio-tools/internal/gen/aepapi"
)

// The issue tools of the design agent's Issues and issue chats: two more MCP
// routes on the socket, each forwarded to its aep-api surface for the
// route's project (and issue). Unlike the design tools, their descriptors are
// aep-api's own, but kept to a pinned list here: tools/list answers only the
// pinned names aep-api lists, and tools/call of any other name is refused
// before anything is forwarded. Changing a list is a reviewed decision;
// TestIssueToolLists_Pinned pins them.

// IssuesTools are the Issues chat's tools (the Issues page's agent).
var IssuesTools = []string{"search_issues", "create_issue"}

// IssueTools are one issue's chat tools (that issue's agent).
var IssueTools = []string{
	"get_issue",
	"list_components",
	"comment_issue",
	"edit_issue",
	"close_issue",
	"reopen_issue",
	"hand_to_coding_agent",
}

// issuesCaller is the generated aep-api client's two issues MCP operations
// (raw JSON-RPC bodies).
type issuesCaller interface {
	CallAeStudioIssuesMcpToolWithBodyWithResponse(ctx context.Context, projectName string, contentType string, body io.Reader, reqEditors ...aepapi.RequestEditorFn) (*aepapi.CallAeStudioIssuesMcpToolResponse, error)
	CallAeStudioIssueMcpToolWithBodyWithResponse(ctx context.Context, projectName string, issueNumber int, contentType string, body io.Reader, reqEditors ...aepapi.RequestEditorFn) (*aepapi.CallAeStudioIssueMcpToolResponse, error)
}

// IssuesUpstreams opens the aep-api surface a route forwards to, over the
// generated client (the org's ae-studio client token): aep-api binds the org
// that client is recorded for and the project (and issue) its path names.
type IssuesUpstreams struct {
	client issuesCaller
}

// NewIssuesUpstreams is IssuesUpstreams over the aep-api client.
func NewIssuesUpstreams(c issuesCaller) IssuesUpstreams { return IssuesUpstreams{client: c} }

// Issues is the Issues chat's surface on project.
func (u IssuesUpstreams) Issues(project string) Upstream {
	return upstreamFunc(func(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
		return exchange(ctx, method, params, func(ctx context.Context, body io.Reader) (int, []byte, error) {
			resp, err := u.client.CallAeStudioIssuesMcpToolWithBodyWithResponse(ctx, project, "application/json", body)
			if err != nil {
				return 0, nil, err
			}
			return resp.StatusCode(), resp.Body, nil
		})
	})
}

// Issue is the chat surface of issue number of project.
func (u IssuesUpstreams) Issue(project string, number int) Upstream {
	return upstreamFunc(func(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
		return exchange(ctx, method, params, func(ctx context.Context, body io.Reader) (int, []byte, error) {
			resp, err := u.client.CallAeStudioIssueMcpToolWithBodyWithResponse(ctx, project, number, "application/json", body)
			if err != nil {
				return 0, nil, err
			}
			return resp.StatusCode(), resp.Body, nil
		})
	})
}

// upstreamFunc adapts a function to Upstream.
type upstreamFunc func(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error)

func (f upstreamFunc) Call(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	return f(ctx, method, params)
}

// IssuesServer answers an issues route's JSON-RPC methods against its
// upstream: initialize locally, tools/list as aep-api lists it kept to the
// pinned names, tools/call of a pinned name forwarded (name and arguments
// only). Any other method is method-not-found.
type IssuesServer struct {
	// Log receives mcp.tools_call; nil is slog.Default().
	Log *slog.Logger
}

// Call answers one JSON-RPC request on the surface up, whose pinned tool
// names are allowed. A refusal or an error aep-api answered is an
// *RPCError; aep-api being unavailable is ErrUpstreamUnavailable.
func (s IssuesServer) Call(ctx context.Context, up Upstream, allowed []string, method string, params json.RawMessage) (json.RawMessage, error) {
	switch method {
	case "initialize":
		return json.Marshal(map[string]any{
			"protocolVersion": ProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "ae-studio-tools", "version": "1.0.0"},
		})
	case "tools/list":
		return listPinned(ctx, up, allowed)
	case "tools/call":
		return s.callPinned(ctx, up, allowed, params)
	default:
		return nil, &RPCError{Code: codeMethodNotFound, Message: "method not found: " + method}
	}
}

// listPinned answers aep-api's tools/list with every tool off the pinned list
// dropped, in aep-api's order.
func listPinned(ctx context.Context, up Upstream, allowed []string) (json.RawMessage, error) {
	result, err := up.Call(ctx, "tools/list", json.RawMessage(`{}`))
	if err != nil {
		return nil, err
	}
	var listed struct {
		Tools []json.RawMessage `json:"tools"`
	}
	if err := json.Unmarshal(result, &listed); err != nil {
		return nil, ErrUpstreamUnavailable
	}
	kept := make([]json.RawMessage, 0, len(listed.Tools))
	for _, t := range listed.Tools {
		var named struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(t, &named) == nil && slices.Contains(allowed, named.Name) {
			kept = append(kept, t)
		}
	}
	return json.Marshal(map[string]any{"tools": kept})
}

// callPinned refuses a name off the pinned list, then forwards the call's
// name and arguments.
func (s IssuesServer) callPinned(ctx context.Context, up Upstream, allowed []string, params json.RawMessage) (json.RawMessage, error) {
	var call struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &call); err != nil || call.Name == "" {
		return nil, &RPCError{Code: codeInvalidParams, Message: "invalid params: tools/call needs a tool name"}
	}
	if !slices.Contains(allowed, call.Name) {
		return nil, &RPCError{Code: codeInvalidParams, Message: "tool not allowed: " + call.Name}
	}
	if len(call.Arguments) == 0 || string(call.Arguments) == "null" {
		call.Arguments = json.RawMessage(`{}`)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(call.Arguments, &object); err != nil {
		return nil, &RPCError{Code: codeInvalidParams, Message: "invalid params: arguments must be an object"}
	}
	log := s.Log
	if log == nil {
		log = slog.Default()
	}
	log.InfoContext(ctx, "mcp.tools_call", "tool", call.Name, "upstream", "aep-api")
	forward, _ := json.Marshal(struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}{call.Name, call.Arguments})
	return up.Call(ctx, "tools/call", forward)
}
