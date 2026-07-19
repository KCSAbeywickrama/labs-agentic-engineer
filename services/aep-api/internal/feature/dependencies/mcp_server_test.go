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

package dependencies

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/endpoints"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/models"
)

// ---- fake ports -------------------------------------------------------------

type fakeResourceReader struct {
	items   []models.ExternalResource
	listErr error
	getErr  error
	// lastOrg records the org the handler passed down, proving it flows from
	// the request context (the verified claim) into the port call.
	lastOrg string
}

func (f *fakeResourceReader) List(_ context.Context, orgID string) ([]models.ExternalResource, error) {
	f.lastOrg = orgID
	return f.items, f.listErr
}

func (f *fakeResourceReader) Get(_ context.Context, orgID, name string) (*models.ExternalResource, error) {
	f.lastOrg = orgID
	if f.getErr != nil {
		return nil, f.getErr
	}
	for i := range f.items {
		if f.items[i].Name == name {
			return &f.items[i], nil
		}
	}
	return nil, nil
}

type fakeEndpointLister struct {
	items   []openchoreo.WorkloadEndpointInfo
	err     error
	lastOrg string
	// lastCtxServiceIdentity records whether the handler marked the tool-call
	// context as service identity before hitting the port. Without the marker
	// the OC transport treats the request's MCP bearer as a forwardable user
	// JWT and OC 401s every catalog read (caught live in E2E S3).
	lastCtxServiceIdentity bool

	// resolved/resolvedErr back ListResolved (the A3 list_org_component_endpoints
	// tool). lastResolvedOrg/lastResolvedCtxServiceIdentity mirror the List
	// fields above for the resolved path.
	resolved                       []endpoints.OrgComponentEndpoint
	resolvedErr                    error
	lastResolvedOrg                string
	lastResolvedCtxServiceIdentity bool
}

func (f *fakeEndpointLister) List(ctx context.Context, orgHandle string) ([]openchoreo.WorkloadEndpointInfo, error) {
	f.lastOrg = orgHandle
	f.lastCtxServiceIdentity = auth.IsServiceIdentity(ctx)
	return f.items, f.err
}

func (f *fakeEndpointLister) ListResolved(ctx context.Context, orgHandle string) ([]endpoints.OrgComponentEndpoint, error) {
	f.lastResolvedOrg = orgHandle
	f.lastResolvedCtxServiceIdentity = auth.IsServiceIdentity(ctx)
	return f.resolved, f.resolvedErr
}

type fakeTypeLister struct {
	items []resources.PlatformResourceType
	err   error
}

func (f *fakeTypeLister) List(context.Context) ([]resources.PlatformResourceType, error) {
	return f.items, f.err
}

// ---- helpers ----------------------------------------------------------------

// postRPC sends body to the handler with the org already bound on the context
// (as the auth middleware would) and returns the recorder.
func postRPC(t *testing.T, h http.Handler, org, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/internal/v1/mcp", strings.NewReader(body))
	if org != "" {
		req = req.WithContext(auth.WithMCPOrg(req.Context(), org))
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

// decodeRPC decodes a 200 JSON-RPC response.
func decodeRPC(t *testing.T, w *httptest.ResponseRecorder) jsonrpcResponse {
	t.Helper()
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", w.Code, w.Body.String())
	}
	var resp jsonrpcResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

// toolText extracts content[0].text from a successful tools/call result and
// asserts the isError flag matches wantErr.
func toolText(t *testing.T, resp jsonrpcResponse, wantErr bool) string {
	t.Helper()
	if resp.Error != nil {
		t.Fatalf("unexpected JSON-RPC error: %+v", resp.Error)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result is not an object: %T", resp.Result)
	}
	isErr, _ := result["isError"].(bool)
	if isErr != wantErr {
		t.Fatalf("isError = %v, want %v (result %+v)", isErr, wantErr, result)
	}
	content, ok := result["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("expected non-empty content array, got %+v", result["content"])
	}
	block, ok := content[0].(map[string]any)
	if !ok {
		t.Fatalf("content[0] is not an object: %T", content[0])
	}
	text, ok := block["text"].(string)
	if !ok {
		t.Fatalf("content[0].text is not a string: %T", block["text"])
	}
	return text
}

func callBody(tool, args string) string {
	return fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, tool, args)
}

func sampleHandler() (http.Handler, *fakeResourceReader, *fakeEndpointLister) {
	er := &fakeResourceReader{items: []models.ExternalResource{{
		Name:        "salesforce",
		Description: "CRM",
		ConfigKeys: models.ConfigKeySlice{
			{Key: "SALESFORCE_URL", Secret: false},
			{Key: "SALESFORCE_TOKEN", Secret: true},
		},
	}}}
	ep := &fakeEndpointLister{
		items: []openchoreo.WorkloadEndpointInfo{
			{Project: "billing", Component: "invoice-api", Name: "rest", Type: "HTTP", Visibility: []string{"namespace"}},
			{Project: "crm", Component: "leads-api", Name: "grpc", Type: "gRPC"}, // not published cross-project
		},
		resolved: []endpoints.OrgComponentEndpoint{
			{
				Project: "billing", Component: "invoice-api", Endpoint: "rest", Type: "HTTP",
				Port: 8080, BasePath: "/api", NamespaceVisible: true,
				Owner: "wso2", Repo: "billing-svc", Subdir: "services/invoice-api", Branch: "main",
				Spec: endpoints.EndpointSpec{
					Availability:  "inline",
					InlineContent: "openapi: 3.0.0\ninfo:\n  title: invoice-api\n",
					Path:          "specs/design/components/invoice-api/openapi.yaml",
				},
			},
			{
				Project: "crm", Component: "leads-api", Endpoint: "grpc", Type: "gRPC",
				Spec: endpoints.EndpointSpec{Availability: "none"},
			},
		},
	}
	rt := &fakeTypeLister{items: []resources.PlatformResourceType{
		{Name: "postgres", Description: "A dedicated PostgreSQL database cluster.", Outputs: []string{"host", "port"}},
	}}
	return NewMCPHandler(er, ep, rt, &fakeRemoteGit{},
		artifacts.ValidateOpenAPI, artifacts.NormalizeOpenAPIYAML, artifacts.FetchSpecFromURL), er, ep
}

// fakeRemoteGit is a stub RemoteGitReader for the handler-dispatch tests. It
// records the org + owner the handler passed down (proving org flows from the
// verified context, not a tool param) and returns canned results or errors.
type fakeRemoteGit struct {
	file      *RemoteGitFile
	hits      []RemoteGitSearchHit
	err       error
	lastOrg   string
	lastOwner string
}

func (f *fakeRemoteGit) GetFileContents(_ context.Context, ocOrgID, owner, _, _, _ string) (*RemoteGitFile, error) {
	f.lastOrg, f.lastOwner = ocOrgID, owner
	if f.err != nil {
		return nil, f.err
	}
	return f.file, nil
}

func (f *fakeRemoteGit) SearchCode(_ context.Context, ocOrgID, owner, _, _ string) ([]RemoteGitSearchHit, error) {
	f.lastOrg, f.lastOwner = ocOrgID, owner
	if f.err != nil {
		return nil, f.err
	}
	return f.hits, nil
}

// ---- protocol ----------------------------------------------------------------

func TestMCP_Initialize(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", `{"jsonrpc":"2.0","id":1,"method":"initialize"}`))
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}
	result := resp.Result.(map[string]any)
	if result["protocolVersion"] != mcpProtocolVersion {
		t.Errorf("protocolVersion = %v, want %q", result["protocolVersion"], mcpProtocolVersion)
	}
	if _, ok := result["capabilities"].(map[string]any)["tools"]; !ok {
		t.Errorf("capabilities missing tools: %+v", result["capabilities"])
	}
}

func TestMCP_Ping(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", `{"jsonrpc":"2.0","id":7,"method":"ping"}`))
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}
	if string(resp.ID) != "7" {
		t.Errorf("response id = %s, want 7", resp.ID)
	}
}

func TestMCP_ToolsList_RenamedTools(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}
	raw, _ := json.Marshal(resp.Result)
	var result struct {
		Tools []mcpTool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("unmarshal tools: %v", err)
	}
	var names []string
	for _, tool := range result.Tools {
		names = append(names, tool.Name)
		if strings.Contains(strings.ToLower(tool.Name), "connection") ||
			strings.Contains(strings.ToLower(tool.Description), "connection") {
			t.Errorf("tool %q leaks banned 'connection' terminology", tool.Name)
		}
	}
	want := []string{
		"list_external_resources",
		"get_external_resource_schema",
		"list_org_endpoints",
		"list_org_component_endpoints",
		"list_platform_resource_types",
		"get_remote_git_file_contents",
		"search_remote_git_code",
		"validate_openapi_spec",
		"fetch_openapi_spec",
	}
	if len(names) != len(want) {
		t.Fatalf("tools = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("tools[%d] = %q, want %q", i, names[i], want[i])
		}
	}
}

func TestMCP_Notification_202NoBody(t *testing.T) {
	h, _, _ := sampleHandler()
	w := postRPC(t, h, "org-1", `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Fatalf("expected empty body, got %q", w.Body.String())
	}
}

func TestMCP_ParseError(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", `{not json`))
	if resp.Error == nil || resp.Error.Code != -32700 {
		t.Fatalf("error = %+v, want code -32700", resp.Error)
	}
}

func TestMCP_MethodNotFound(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`))
	if resp.Error == nil || resp.Error.Code != -32601 {
		t.Fatalf("error = %+v, want code -32601", resp.Error)
	}
}

func TestMCP_UnknownTool(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_connections", `{}`)))
	if resp.Error == nil || resp.Error.Code != -32602 {
		t.Fatalf("error = %+v, want code -32602 (source tool names must be gone)", resp.Error)
	}
}

// ---- guards ------------------------------------------------------------------

func TestMCP_NilResourceReader_503(t *testing.T) {
	h := NewMCPHandler(nil, &fakeEndpointLister{}, &fakeTypeLister{}, &fakeRemoteGit{}, nil, nil, nil)
	w := postRPC(t, h, "org-1", `{"jsonrpc":"2.0","id":1,"method":"ping"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestMCP_NoOrgOnContext_401(t *testing.T) {
	h, _, _ := sampleHandler()
	w := postRPC(t, h, "", `{"jsonrpc":"2.0","id":1,"method":"ping"}`)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (unwrapped mount must fail closed)", w.Code)
	}
}

// ---- tools/call ----------------------------------------------------------------

func TestMCP_ListExternalResources(t *testing.T) {
	h, er, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_external_resources", `{}`)))
	text := toolText(t, resp, false)

	var payload struct {
		ExternalResources []externalResourceView `json:"externalResources"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if len(payload.ExternalResources) != 1 {
		t.Fatalf("externalResources = %+v, want 1 entry", payload.ExternalResources)
	}
	got := payload.ExternalResources[0]
	if got.Name != "salesforce" || got.Description != "CRM" || len(got.ConfigKeys) != 2 {
		t.Errorf("unexpected view: %+v", got)
	}
	if !got.ConfigKeys[1].Secret {
		t.Errorf("SALESFORCE_TOKEN must be marked secret: %+v", got.ConfigKeys)
	}
	if er.lastOrg != "org-1" {
		t.Errorf("port called with org %q, want org-1 (context org must flow down)", er.lastOrg)
	}
}

func TestMCP_ListExternalResources_PortError(t *testing.T) {
	er := &fakeResourceReader{listErr: fmt.Errorf("db down")}
	h := NewMCPHandler(er, nil, nil, nil, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_external_resources", `{}`)))
	text := toolText(t, resp, true)
	if !strings.Contains(text, "db down") {
		t.Errorf("tool error text = %q, want it to carry the port error", text)
	}
}

func TestMCP_GetExternalResourceSchema(t *testing.T) {
	h, _, _ := sampleHandler()

	t.Run("found", func(t *testing.T) {
		resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("get_external_resource_schema", `{"name":"salesforce"}`)))
		text := toolText(t, resp, false)
		var payload struct {
			Found            bool                 `json:"found"`
			ExternalResource externalResourceView `json:"externalResource"`
		}
		if err := json.Unmarshal([]byte(text), &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if !payload.Found || payload.ExternalResource.Name != "salesforce" {
			t.Errorf("unexpected payload: %+v", payload)
		}
	})

	t.Run("not found", func(t *testing.T) {
		resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("get_external_resource_schema", `{"name":"stripe"}`)))
		text := toolText(t, resp, false)
		var payload struct {
			Found bool   `json:"found"`
			Name  string `json:"name"`
		}
		if err := json.Unmarshal([]byte(text), &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if payload.Found || payload.Name != "stripe" {
			t.Errorf("unexpected payload: %+v", payload)
		}
	})

	t.Run("missing name", func(t *testing.T) {
		resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("get_external_resource_schema", `{}`)))
		text := toolText(t, resp, true)
		if !strings.Contains(text, "name") {
			t.Errorf("tool error text = %q, want it to name the missing argument", text)
		}
	})
}

func TestMCP_ListOrgEndpoints(t *testing.T) {
	h, _, ep := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_org_endpoints", `{}`)))
	text := toolText(t, resp, false)

	var payload struct {
		Endpoints []orgEndpointView `json:"endpoints"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if len(payload.Endpoints) != 2 {
		t.Fatalf("endpoints = %+v, want 2 entries", payload.Endpoints)
	}
	first := payload.Endpoints[0]
	if first.Name != "invoice-api" || first.Project != "billing" || first.Endpoint != "rest" ||
		first.Type != "HTTP" || !first.NamespaceVisible {
		t.Errorf("unexpected first endpoint view: %+v", first)
	}
	if payload.Endpoints[1].NamespaceVisible {
		t.Errorf("endpoint without namespace visibility must report namespaceVisible=false")
	}
	if ep.lastOrg != "org-1" {
		t.Errorf("lister called with org %q, want org-1", ep.lastOrg)
	}
	if !ep.lastCtxServiceIdentity {
		t.Errorf("tool-call context must be marked service identity — otherwise the OC transport forwards the MCP bearer as a user JWT and every catalog read 401s")
	}
}

func TestMCP_ListOrgEndpoints_NilLister_Empty(t *testing.T) {
	er := &fakeResourceReader{}
	h := NewMCPHandler(er, nil, nil, nil, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_org_endpoints", `{}`)))
	text := toolText(t, resp, false)
	if text != `{"endpoints":[]}` {
		t.Errorf("payload = %q, want empty endpoints", text)
	}
}

func TestMCP_ListOrgComponentEndpoints(t *testing.T) {
	h, _, ep := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_org_component_endpoints", `{}`)))
	text := toolText(t, resp, false)

	var payload struct {
		Endpoints []orgComponentEndpointView `json:"endpoints"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if len(payload.Endpoints) != 2 {
		t.Fatalf("endpoints = %+v, want 2 entries", payload.Endpoints)
	}
	first := payload.Endpoints[0]
	if first.Project != "billing" || first.Component != "invoice-api" || first.Endpoint != "rest" ||
		first.Type != "HTTP" || first.Port != 8080 || first.BasePath != "/api" || !first.NamespaceVisible ||
		first.Owner != "wso2" || first.Repo != "billing-svc" || first.Subdir != "services/invoice-api" ||
		first.Branch != "main" {
		t.Errorf("unexpected first endpoint view: %+v", first)
	}
	if first.Spec.Availability != "inline" {
		t.Errorf("first.Spec.Availability = %q, want inline", first.Spec.Availability)
	}
	if first.Spec.InlineContent == "" {
		t.Errorf("first.Spec.InlineContent must be populated for the inline case")
	}
	second := payload.Endpoints[1]
	if second.Spec.Availability != "none" {
		t.Errorf("second.Spec.Availability = %q, want none", second.Spec.Availability)
	}
	if ep.lastResolvedOrg != "org-1" {
		t.Errorf("resolver called with org %q, want org-1", ep.lastResolvedOrg)
	}
	if !ep.lastResolvedCtxServiceIdentity {
		t.Errorf("tool-call context must be marked service identity — otherwise the OC transport forwards the MCP bearer as a user JWT and every catalog read 401s")
	}
}

func TestMCP_ListOrgComponentEndpoints_NilLister_Empty(t *testing.T) {
	er := &fakeResourceReader{}
	h := NewMCPHandler(er, nil, nil, nil, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_org_component_endpoints", `{}`)))
	text := toolText(t, resp, false)
	if text != `{"endpoints":[]}` {
		t.Errorf("payload = %q, want empty endpoints", text)
	}
}

func TestMCP_ListPlatformResourceTypes(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_platform_resource_types", `{}`)))
	text := toolText(t, resp, false)

	var payload struct {
		ResourceTypes []resources.PlatformResourceType `json:"resourceTypes"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if len(payload.ResourceTypes) != 1 || payload.ResourceTypes[0].Name != "postgres" {
		t.Errorf("unexpected payload: %+v", payload)
	}
	// The self-description flows through to the architect-facing payload —
	// assert on the raw JSON text so a `json:"-"` regression cannot pass.
	if !strings.Contains(text, `"description":"A dedicated PostgreSQL database cluster."`) {
		t.Errorf("payload missing serialized description: %s", text)
	}
	// Markers stay internal (json:"-") — no marker leakage into the payload.
	if strings.Contains(text, "Markers") || strings.Contains(text, "EndUserAuth") {
		t.Errorf("payload leaks internal Markers: %s", text)
	}
}

func TestMCP_ListPlatformResourceTypes_NilLister_Empty(t *testing.T) {
	er := &fakeResourceReader{}
	h := NewMCPHandler(er, nil, nil, nil, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("list_platform_resource_types", `{}`)))
	text := toolText(t, resp, false)
	if text != `{"resourceTypes":[]}` {
		t.Errorf("payload = %q, want empty resourceTypes", text)
	}
}

// ---- remote-git tools (endpoint spec discovery) --------------------------------

func TestMCP_GetRemoteGitFileContents(t *testing.T) {
	rg := &fakeRemoteGit{file: &RemoteGitFile{Content: "openapi: 3.0.0\n", SHA: "abc"}}
	h := NewMCPHandler(&fakeResourceReader{}, nil, nil, rg, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1",
		callBody("get_remote_git_file_contents", `{"owner":"acme","repo":"billing-svc","path":"specs/openapi.yaml","ref":"main"}`)))
	text := toolText(t, resp, false)

	var payload remoteGitFileView
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Content != "openapi: 3.0.0\n" || payload.SHA != "abc" || payload.IsDirectory {
		t.Errorf("unexpected payload: %+v", payload)
	}
	// The org MUST be the verified context claim, never a tool arg.
	if rg.lastOrg != "org-1" {
		t.Errorf("reader saw org %q, want org-1 (from the verified claim)", rg.lastOrg)
	}
	if rg.lastOwner != "acme" {
		t.Errorf("reader saw owner %q, want acme", rg.lastOwner)
	}
}

func TestMCP_GetRemoteGitFileContents_Directory(t *testing.T) {
	rg := &fakeRemoteGit{file: &RemoteGitFile{IsDirectory: true, Entries: []RemoteGitEntry{
		{Path: "specs/openapi.yaml", Type: "file", SHA: "a"},
	}}}
	h := NewMCPHandler(&fakeResourceReader{}, nil, nil, rg, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1",
		callBody("get_remote_git_file_contents", `{"owner":"acme","repo":"billing-svc","path":"specs"}`)))
	text := toolText(t, resp, false)
	var payload remoteGitFileView
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if !payload.IsDirectory || len(payload.Entries) != 1 || payload.Entries[0].Path != "specs/openapi.yaml" {
		t.Errorf("unexpected directory payload: %+v", payload)
	}
}

func TestMCP_GetRemoteGitFileContents_OwnerMismatch_ToolError(t *testing.T) {
	// The reader refuses a cross-org owner; the handler must surface it as a
	// tool-level error (isError=true), not data.
	rg := &fakeRemoteGit{err: ErrOwnerNotInOrg}
	h := NewMCPHandler(&fakeResourceReader{}, nil, nil, rg, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1",
		callBody("get_remote_git_file_contents", `{"owner":"evilcorp","repo":"secret","path":"x"}`)))
	text := toolText(t, resp, true) // wantErr = true
	if !strings.Contains(text, "owner") {
		t.Errorf("tool error = %q, want it to mention the owner refusal", text)
	}
}

func TestMCP_GetRemoteGitFileContents_MissingArgs_ToolError(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1",
		callBody("get_remote_git_file_contents", `{"repo":"billing-svc","path":"x"}`))) // no owner
	toolText(t, resp, true)
}

func TestMCP_GetRemoteGitFileContents_NilReader_ToolError(t *testing.T) {
	h := NewMCPHandler(&fakeResourceReader{}, nil, nil, nil, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1",
		callBody("get_remote_git_file_contents", `{"owner":"acme","repo":"r","path":"x"}`)))
	toolText(t, resp, true)
}

func TestMCP_SearchRemoteGitCode(t *testing.T) {
	rg := &fakeRemoteGit{hits: []RemoteGitSearchHit{
		{Path: "specs/openapi.yaml", SHA: "a"},
		{Path: "api/openapi.yaml", SHA: "b"},
	}}
	h := NewMCPHandler(&fakeResourceReader{}, nil, nil, rg, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1",
		callBody("search_remote_git_code", `{"owner":"acme","repo":"billing-svc","query":"openapi"}`)))
	text := toolText(t, resp, false)
	var payload struct {
		Items []remoteGitSearchHitView `json:"items"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if len(payload.Items) != 2 || payload.Items[0].Path != "specs/openapi.yaml" {
		t.Errorf("unexpected payload: %+v", payload)
	}
	if rg.lastOrg != "org-1" {
		t.Errorf("reader saw org %q, want org-1", rg.lastOrg)
	}
}

func TestMCP_SearchRemoteGitCode_MissingQuery_ToolError(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1",
		callBody("search_remote_git_code", `{"owner":"acme","repo":"billing-svc"}`)))
	toolText(t, resp, true)
}

// The two remote-git tools must be advertised by tools/list.
func TestMCP_ToolsList_IncludesRemoteGitTools(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	result := resp.Result.(map[string]any)
	tools, _ := result["tools"].([]any)
	names := map[string]bool{}
	for _, tr := range tools {
		if m, ok := tr.(map[string]any); ok {
			names[m["name"].(string)] = true
		}
	}
	for _, want := range []string{"get_remote_git_file_contents", "search_remote_git_code"} {
		if !names[want] {
			t.Errorf("tools/list missing %q (got %v)", want, names)
		}
	}
}

// ---- spec tools (validate_openapi_spec, fetch_openapi_spec) -------------------

// specToolSampleSpec is a minimal valid OpenAPI 3.x document with 3 operations
// (mirrors artifacts' own sampleSpec fixture) used across the spec-tool tests.
const specToolSampleSpec = `openapi: 3.0.3
info: { title: Weather, version: "1.0" }
paths:
  /weather:
    get: { responses: { "200": { description: ok } } }
  /forecast:
    get: { responses: { "200": { description: ok } } }
    post: { responses: { "201": { description: created } } }
`

// toolSchema is the subset of an mcpTool.InputSchema this file's schema-shape
// assertions read.
type toolSchema struct {
	Type       string                    `json:"type"`
	Properties map[string]map[string]any `json:"properties"`
	Required   []string                  `json:"required"`
}

// schemaOf decodes tool's InputSchema into toolSchema.
func schemaOf(t *testing.T, tool mcpTool) toolSchema {
	t.Helper()
	raw, err := json.Marshal(tool.InputSchema)
	if err != nil {
		t.Fatalf("marshal inputSchema: %v", err)
	}
	var s toolSchema
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("unmarshal inputSchema: %v", err)
	}
	return s
}

// TestMCP_ToolsList_SpecToolsSchema asserts validate_openapi_spec and
// fetch_openapi_spec are advertised with the exact schema shape the other
// tools use: an object with a single required string argument.
func TestMCP_ToolsList_SpecToolsSchema(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	raw, _ := json.Marshal(resp.Result)
	var result struct {
		Tools []mcpTool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("unmarshal tools: %v", err)
	}
	byName := map[string]mcpTool{}
	for _, tool := range result.Tools {
		byName[tool.Name] = tool
	}

	validate, ok := byName["validate_openapi_spec"]
	if !ok {
		t.Fatal("validate_openapi_spec missing from tools/list")
	}
	if s := schemaOf(t, validate); s.Type != "object" || s.Properties["content"] == nil ||
		len(s.Required) != 1 || s.Required[0] != "content" {
		t.Errorf("validate_openapi_spec schema = %+v, want object with required %q", s, "content")
	}

	fetch, ok := byName["fetch_openapi_spec"]
	if !ok {
		t.Fatal("fetch_openapi_spec missing from tools/list")
	}
	if s := schemaOf(t, fetch); s.Type != "object" || s.Properties["url"] == nil ||
		len(s.Required) != 1 || s.Required[0] != "url" {
		t.Errorf("fetch_openapi_spec schema = %+v, want object with required %q", s, "url")
	}
}

func TestMCP_ValidateOpenAPISpec_Good(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("validate_openapi_spec", fmt.Sprintf(`{"content":%q}`, specToolSampleSpec))))
	text := toolText(t, resp, false)

	var payload validateSpecView
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if !payload.Valid {
		t.Fatalf("valid = false, want true (errors %v)", payload.Errors)
	}
	if payload.Operations != 3 {
		t.Errorf("operations = %d, want 3", payload.Operations)
	}
	if payload.NormalizedContent == "" {
		t.Errorf("normalizedContent is empty, want the canonical-form doc")
	}
	if len(payload.Errors) != 0 {
		t.Errorf("errors = %v, want empty", payload.Errors)
	}
}

// TestMCP_ValidateOpenAPISpec_Bad asserts an invalid document is reported IN
// the payload (valid=false, errors populated) — the tool call itself succeeds
// (isError=false); only a missing argument or unconfigured port is a tool
// error.
func TestMCP_ValidateOpenAPISpec_Bad(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("validate_openapi_spec", `{"content":"foo: bar"}`)))
	text := toolText(t, resp, false)

	var payload validateSpecView
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Valid {
		t.Fatalf("valid = true, want false for a non-OpenAPI document")
	}
	if len(payload.Errors) == 0 {
		t.Fatalf("errors is empty, want at least one parse error")
	}
	if payload.NormalizedContent != "" {
		t.Errorf("normalizedContent = %q, want empty when invalid", payload.NormalizedContent)
	}
}

func TestMCP_ValidateOpenAPISpec_MissingContent_ToolError(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("validate_openapi_spec", `{}`)))
	text := toolText(t, resp, true)
	if !strings.Contains(text, "content") {
		t.Errorf("tool error text = %q, want it to name the missing argument", text)
	}
}

func TestMCP_ValidateOpenAPISpec_NilPort_ToolError(t *testing.T) {
	h := NewMCPHandler(&fakeResourceReader{}, nil, nil, nil, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("validate_openapi_spec", `{"content":"whatever"}`)))
	toolText(t, resp, true)
}

// handlerWithFetcher wires a stub SpecFetcher alongside the REAL
// artifacts.ValidateOpenAPI/NormalizeOpenAPIYAML, isolating fetch_openapi_spec's
// own logic (size cap, validate+normalize wiring) from the network. SSRF
// behavior itself is exercised separately, through the real
// artifacts.FetchSpecFromURL (see TestMCP_FetchOpenAPISpec_SSRFBlocked).
func handlerWithFetcher(fetch SpecFetcher) http.Handler {
	return NewMCPHandler(&fakeResourceReader{}, nil, nil, nil,
		artifacts.ValidateOpenAPI, artifacts.NormalizeOpenAPIYAML, fetch)
}

func TestMCP_FetchOpenAPISpec_Good(t *testing.T) {
	var gotURL string
	h := handlerWithFetcher(func(_ context.Context, url string) ([]byte, error) {
		gotURL = url
		return []byte(specToolSampleSpec), nil
	})
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"https://example.com/openapi.yaml"}`)))
	text := toolText(t, resp, false)

	var payload fetchSpecView
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Operations != 3 {
		t.Errorf("operations = %d, want 3", payload.Operations)
	}
	if payload.Content == "" {
		t.Errorf("content is empty, want the normalized doc")
	}
	if payload.SourceURL != "https://example.com/openapi.yaml" {
		t.Errorf("sourceUrl = %q, want the requested url echoed back", payload.SourceURL)
	}
	if gotURL != "https://example.com/openapi.yaml" {
		t.Errorf("fetcher saw url %q, want the requested url", gotURL)
	}
}

// TestMCP_FetchOpenAPISpec_TooLarge_ToolError asserts the tool-level 256 KiB
// cap rejects an oversized fetch with the exact "too large" message BEFORE
// validation runs — a context-safety guard layered on top of (never a
// substitute for) FetchSpecFromURL's own 5 MiB SSRF-hardened cap.
func TestMCP_FetchOpenAPISpec_TooLarge_ToolError(t *testing.T) {
	oversized := make([]byte, maxToolSpecBytes+1)
	h := handlerWithFetcher(func(context.Context, string) ([]byte, error) { return oversized, nil })
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"https://example.com/openapi.yaml"}`)))
	text := toolText(t, resp, true)
	if text != "spec too large — ask the user for a trimmed spec" {
		t.Errorf("tool error text = %q, want the exact too-large message", text)
	}
}

func TestMCP_FetchOpenAPISpec_AtCap_OK(t *testing.T) {
	// Exactly at the cap must NOT be rejected — only strictly over it.
	atCap := []byte(specToolSampleSpec + strings.Repeat(" ", maxToolSpecBytes-len(specToolSampleSpec)))
	if len(atCap) != maxToolSpecBytes {
		t.Fatalf("test fixture len = %d, want exactly %d", len(atCap), maxToolSpecBytes)
	}
	h := handlerWithFetcher(func(context.Context, string) ([]byte, error) { return atCap, nil })
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"https://example.com/openapi.yaml"}`)))
	toolText(t, resp, false)
}

func TestMCP_FetchOpenAPISpec_FailedValidation_ToolError(t *testing.T) {
	h := handlerWithFetcher(func(context.Context, string) ([]byte, error) { return []byte("foo: bar"), nil })
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"https://example.com/openapi.yaml"}`)))
	text := toolText(t, resp, true)
	if !strings.Contains(text, "failed validation") {
		t.Errorf("tool error text = %q, want it to report validation failure", text)
	}
}

func TestMCP_FetchOpenAPISpec_FetchError_ToolError(t *testing.T) {
	h := handlerWithFetcher(func(context.Context, string) ([]byte, error) { return nil, fmt.Errorf("connection refused") })
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"https://example.com/openapi.yaml"}`)))
	text := toolText(t, resp, true)
	if !strings.Contains(text, "connection refused") {
		t.Errorf("tool error text = %q, want it to carry the fetch error", text)
	}
}

func TestMCP_FetchOpenAPISpec_MissingURL_ToolError(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{}`)))
	text := toolText(t, resp, true)
	if !strings.Contains(text, "url") {
		t.Errorf("tool error text = %q, want it to name the missing argument", text)
	}
}

func TestMCP_FetchOpenAPISpec_NilPort_ToolError(t *testing.T) {
	h := NewMCPHandler(&fakeResourceReader{}, nil, nil, nil, nil, nil, nil)
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"https://example.com/openapi.yaml"}`)))
	toolText(t, resp, true)
}

// TestMCP_FetchOpenAPISpec_SSRFBlocked_RealGuardUnweakened proves the MCP tool
// wiring reuses artifacts.FetchSpecFromURL's SSRF hardening AS-IS: routed
// through the real function (sampleHandler wires it, not a stub), a loopback
// URL must still be refused. A regression that wraps/relaxes the guard would
// make this test pass a real fetch through instead of rejecting it.
func TestMCP_FetchOpenAPISpec_SSRFBlocked_RealGuardUnweakened(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"https://127.0.0.1/openapi.yaml"}`)))
	text := toolText(t, resp, true)
	if !strings.Contains(text, "non-public address") {
		t.Errorf("tool error text = %q, want the SSRF guard's refusal message (FetchSpecFromURL weakened?)", text)
	}
}

// TestMCP_FetchOpenAPISpec_RejectsNonHTTPS proves the https-only half of the
// SSRF guard also passes through unchanged.
func TestMCP_FetchOpenAPISpec_RejectsNonHTTPS(t *testing.T) {
	h, _, _ := sampleHandler()
	resp := decodeRPC(t, postRPC(t, h, "org-1", callBody("fetch_openapi_spec", `{"url":"http://example.com/openapi.yaml"}`)))
	text := toolText(t, resp, true)
	if !strings.Contains(text, "https") {
		t.Errorf("tool error text = %q, want it to require https", text)
	}
}
