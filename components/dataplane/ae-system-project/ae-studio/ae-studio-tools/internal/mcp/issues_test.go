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
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/wso2/aep/ae-studio-tools/internal/gen/aepapi"
)

// The issue chats' lists are pinned: changing one is a reviewed decision,
// not a side effect of what aep-api serves. classify_report is the Issues
// chat's report classifier, which aep-api answers with the platform's key.
func TestIssueToolLists_Pinned(t *testing.T) {
	if want := []string{"search_issues", "create_issue", "classify_report"}; !reflect.DeepEqual(IssuesTools, want) {
		t.Fatalf("IssuesTools = %v", IssuesTools)
	}
	want := []string{"get_issue", "list_components", "comment_issue", "edit_issue", "close_issue", "reopen_issue", "hand_to_coding_agent"}
	if !reflect.DeepEqual(IssueTools, want) {
		t.Fatalf("IssueTools = %v", IssueTools)
	}
}

// listingUpstream answers tools/list with its tools and records a call.
type listingUpstream struct {
	tools  string
	method string
	params string
}

func (u *listingUpstream) Call(_ context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	u.method, u.params = method, string(params)
	if method == "tools/list" {
		return json.RawMessage(`{"tools":` + u.tools + `}`), nil
	}
	return json.RawMessage(`{"content":[]}`), nil
}

// tools/list is aep-api's, kept to the pinned names in aep-api's order.
func TestIssuesServer_ListKeepsOnlyThePinnedTools(t *testing.T) {
	up := &listingUpstream{tools: `[{"name":"create_issue","description":"d"},{"name":"drop_database"},{"name":"search_issues"}]`}
	out, err := IssuesServer{}.Call(context.Background(), up, IssuesTools, "tools/list", nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"tools":[{"name":"create_issue","description":"d"},{"name":"search_issues"}]}` {
		t.Fatalf("tools/list = %s", out)
	}
}

// Only name and arguments are forwarded; absent arguments are an empty object.
func TestIssuesServer_ForwardsAPinnedCall(t *testing.T) {
	up := &listingUpstream{}
	if _, err := (IssuesServer{}).Call(context.Background(), up, IssueTools, "tools/call", json.RawMessage(`{"name":"get_issue","_meta":{"x":1}}`)); err != nil {
		t.Fatal(err)
	}
	if up.method != "tools/call" || up.params != `{"name":"get_issue","arguments":{}}` {
		t.Fatalf("forwarded %s %s", up.method, up.params)
	}
}

// A name off the surface's list — another surface's included — is refused
// before anything is forwarded, as is anything malformed.
func TestIssuesServer_RefusalsAreJSONRPCErrors(t *testing.T) {
	up := &listingUpstream{}
	for name, c := range map[string]struct {
		method, params string
		code           int
	}{
		"unknown method":      {"ping", `{}`, codeMethodNotFound},
		"another surface's":   {"tools/call", `{"name":"close_issue"}`, codeInvalidParams},
		"a design tool":       {"tools/call", `{"name":"list_groups"}`, codeInvalidParams},
		"no name":             {"tools/call", `{"arguments":{}}`, codeInvalidParams},
		"arguments not a map": {"tools/call", `{"name":"create_issue","arguments":[1]}`, codeInvalidParams},
	} {
		_, err := IssuesServer{}.Call(context.Background(), up, IssuesTools, c.method, json.RawMessage(c.params))
		var rpc *RPCError
		if !errors.As(err, &rpc) || rpc.Code != c.code {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
	if up.method != "" {
		t.Fatalf("a refused call was forwarded: %s", up.params)
	}
}

// fakeIssuesCaller records which aep-api route a surface posts to.
type fakeIssuesCaller struct {
	route string
	reply string
}

func (f *fakeIssuesCaller) CallAeStudioIssuesMcpToolWithBodyWithResponse(_ context.Context, project string, _ string, _ io.Reader, _ ...aepapi.RequestEditorFn) (*aepapi.CallAeStudioIssuesMcpToolResponse, error) {
	f.route = "issues/" + project
	return &aepapi.CallAeStudioIssuesMcpToolResponse{Body: []byte(f.reply), HTTPResponse: &http.Response{StatusCode: http.StatusOK}}, nil
}

func (f *fakeIssuesCaller) CallAeStudioIssueMcpToolWithBodyWithResponse(_ context.Context, project string, number int, _ string, _ io.Reader, _ ...aepapi.RequestEditorFn) (*aepapi.CallAeStudioIssueMcpToolResponse, error) {
	f.route = "issue/" + project + "/" + strings.Repeat("#", number)
	return &aepapi.CallAeStudioIssueMcpToolResponse{Body: []byte(f.reply), HTTPResponse: &http.Response{StatusCode: http.StatusOK}}, nil
}

// Each surface posts to its own aep-api route, scoped by the project (and
// the issue) it was opened for; aep-api's JSON-RPC error comes back as one.
func TestIssuesUpstreams_PostToTheirRoute(t *testing.T) {
	f := &fakeIssuesCaller{reply: `{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}`}
	u := NewIssuesUpstreams(f)
	if _, err := u.Issues("shop").Call(context.Background(), "tools/list", nil); err != nil || f.route != "issues/shop" {
		t.Fatalf("issues route = %q, err %v", f.route, err)
	}
	if _, err := u.Issue("shop", 3).Call(context.Background(), "tools/list", nil); err != nil || f.route != "issue/shop/###" {
		t.Fatalf("issue route = %q, err %v", f.route, err)
	}
	f.reply = `{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"no"}}`
	_, err := u.Issue("shop", 3).Call(context.Background(), "tools/call", nil)
	var rpc *RPCError
	if !errors.As(err, &rpc) || rpc.Code != -32602 {
		t.Fatalf("err = %v", err)
	}
}

// A tool error's result comes back as aep-api answered it, its
// _meta["aep/code"] included: the design agent's open check reads that code.
func TestIssuesServer_ToolErrorKeepsItsCode(t *testing.T) {
	result := `{"content":[{"type":"text","text":"gone"}],"isError":true,"_meta":{"aep/code":"issue_not_found"}}`
	f := &fakeIssuesCaller{reply: `{"jsonrpc":"2.0","id":1,"result":` + result + `}`}
	out, err := IssuesServer{}.Call(context.Background(), NewIssuesUpstreams(f).Issue("shop", 3), IssueTools, "tools/call", json.RawMessage(`{"name":"get_issue"}`))
	if err != nil || string(out) != result {
		t.Fatalf("tools/call = %s, err %v", out, err)
	}
}

// classify_report is forwarded on the Issues route only: an issue's chat
// cannot reach the platform's classifier.
func TestIssuesServer_ClassifyReportOnTheIssuesRouteOnly(t *testing.T) {
	up := &listingUpstream{}
	params := json.RawMessage(`{"name":"classify_report","arguments":{"message":"save does nothing"}}`)
	if _, err := (IssuesServer{}).Call(context.Background(), up, IssuesTools, "tools/call", params); err != nil {
		t.Fatal(err)
	}
	if up.params != `{"name":"classify_report","arguments":{"message":"save does nothing"}}` {
		t.Fatalf("forwarded %s", up.params)
	}
	_, err := IssuesServer{}.Call(context.Background(), &listingUpstream{}, IssueTools, "tools/call", params)
	var rpc *RPCError
	if !errors.As(err, &rpc) || rpc.Code != codeInvalidParams {
		t.Fatalf("an issue's route forwarded classify_report: %v", err)
	}
}
