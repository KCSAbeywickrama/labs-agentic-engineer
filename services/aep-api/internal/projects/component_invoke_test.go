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

package projects

// UNIT tier for Invoke: the REAL componentService (+ REAL ArtifactStore over a
// faked design tree, matching openAPISvc's pattern) against a REAL
// httptest.Server standing in for the deployed component's gateway. The relay
// behaviour — method/path/headers/body/status/caps/timeout — is the unit under
// test, so the HTTP call is never mocked away; only the openchoreo client
// (ListDeployments) and the design tree are faked.

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/gen"

	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/spec"
	"github.com/wso2/aep/aep-api/internal/spec/artifactstest"
)

// invokeTestSvc builds a componentService whose design tree contains the
// components described by files (see designFiles, component_service_test.go)
// and whose one deployment carries endpointURL (empty means "no reachable
// deployment"). timeout <= 0 uses Invoke's own 60s default.
func invokeTestSvc(t *testing.T, files map[string]string, endpointURL string, timeout time.Duration) *componentService {
	t.Helper()
	fake := &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
			return files, nil
		},
	}
	oc := &ocmocks.ComponentClientMock{
		ListDeploymentsFunc: func(context.Context, string, string, string) (*gen.DeploymentList, error) {
			var items []gen.Deployment
			if endpointURL != "" {
				items = append(items, gen.Deployment{EndpointURL: endpointURL})
			}
			return &gen.DeploymentList{Items: items}, nil
		},
	}
	return &componentService{
		client:        oc,
		artifactStore: spec.NewArtifactStore(fake),
		invokeTimeout: timeout,
	}
}

// 1. Happy path: POST /chat relayed — method, path join, Content-Type and
// Authorization forwarded; upstream 200 body comes back verbatim,
// Truncated=false, upstream status preserved.
func TestInvoke_HappyPath_RelaysMethodPathContentTypeAndAuth(t *testing.T) {
	t.Parallel()
	var gotMethod, gotPath, gotCT, gotAuth string
	var gotBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotCT = r.Header.Get("Content-Type")
		gotAuth = r.Header.Get("Authorization")
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(gotBody)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	result, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{
		Method:      "POST",
		Path:        "/chat",
		ContentType: "application/json",
		Body:        []byte(`{"msg":"hi"}`),
	}, "Bearer usertoken")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotMethod != "POST" || gotPath != "/chat" {
		t.Fatalf("want POST /chat relayed, got %s %s", gotMethod, gotPath)
	}
	if gotCT != "application/json" {
		t.Fatalf("want Content-Type forwarded, got %q", gotCT)
	}
	if gotAuth != "Bearer usertoken" {
		t.Fatalf("want Authorization forwarded, got %q", gotAuth)
	}
	if string(gotBody) != `{"msg":"hi"}` {
		t.Fatalf("want request body relayed verbatim, got %q", gotBody)
	}
	if result.Status != http.StatusOK {
		t.Fatalf("want upstream status 200 preserved, got %d", result.Status)
	}
	if string(result.Body) != `{"msg":"hi"}` {
		t.Fatalf("want response body relayed verbatim, got %q", result.Body)
	}
	if result.Truncated {
		t.Fatalf("want Truncated=false")
	}
	if result.ContentType != "application/json" {
		t.Fatalf("want upstream Content-Type relayed, got %q", result.ContentType)
	}
}

// 2. Component not in the caller's project (design has no such component) ->
// ErrComponentNotFound (edge maps to 404).
func TestInvoke_ComponentNotInCallersDesign_ErrComponentNotFound(t *testing.T) {
	t.Parallel()
	svc := invokeTestSvc(t, designFiles("other-component", "service", ""), "http://should-not-be-dialed.invalid", 0)
	_, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: "/x"}, "")
	if !errors.Is(err, ErrComponentNotFound) {
		t.Fatalf("want ErrComponentNotFound, got %v", err)
	}
}

// 3. No deployment / empty EndpointURL -> ErrNotReachable (edge maps to 409
// {reason:"not-reachable"}). An intranet service with no gateway route is
// exactly this case — honest, not an error.
func TestInvoke_NoReachableDeployment_ErrNotReachable(t *testing.T) {
	t.Parallel()
	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), "", 0)
	_, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: "/x"}, "")
	if !errors.Is(err, ErrNotReachable) {
		t.Fatalf("want ErrNotReachable, got %v", err)
	}
}

// 4. Path traversal: "../other", "http://evil", "//evil" -> ErrBadPath (400).
// Assert the upstream fake was NEVER hit.
func TestInvoke_BadPath_RejectedWithoutTouchingUpstream(t *testing.T) {
	t.Parallel()
	hit := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	for _, p := range []string{"../other", "http://evil", "//evil"} {
		if _, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: p}, ""); !errors.Is(err, ErrBadPath) {
			t.Fatalf("path %q: want ErrBadPath, got %v", p, err)
		}
	}
	if hit {
		t.Fatalf("upstream must never be dialed for a rejected path")
	}
}

// 5. Upstream 401/404/500 relayed as InvokeResult.Status — the invoke itself
// succeeds; the tester shows the upstream's own answer.
func TestInvoke_UpstreamErrorStatusesAreRelayedNotErrors(t *testing.T) {
	t.Parallel()
	for _, status := range []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusInternalServerError} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
		}))
		svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
		result, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: "/x"}, "")
		upstream.Close()
		if err != nil {
			t.Fatalf("status %d: want the invoke call to succeed, got err %v", status, err)
		}
		if result.Status != status {
			t.Fatalf("want upstream status %d relayed, got %d", status, result.Status)
		}
	}
}

// 6. Response cap: upstream returns >1 MiB -> Body cut at 1 MiB,
// Truncated=true.
func TestInvoke_ResponseBodyCappedAt1MiB(t *testing.T) {
	t.Parallel()
	big := bytes.Repeat([]byte("a"), invokeMaxResponseBody+100)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(big)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	result, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: "/x"}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Body) != invokeMaxResponseBody {
		t.Fatalf("want body cut to exactly %d bytes, got %d", invokeMaxResponseBody, len(result.Body))
	}
	if !result.Truncated {
		t.Fatalf("want Truncated=true")
	}
}

// 7. Request cap: Body >256 KiB -> ErrBodyTooLarge (413) without calling
// upstream.
func TestInvoke_RequestBodyTooLarge_RejectedWithoutTouchingUpstream(t *testing.T) {
	t.Parallel()
	hit := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	oversized := bytes.Repeat([]byte("a"), invokeMaxRequestBody+1)
	_, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "POST", Path: "/x", Body: oversized}, "")
	if !errors.Is(err, ErrBodyTooLarge) {
		t.Fatalf("want ErrBodyTooLarge, got %v", err)
	}
	if hit {
		t.Fatalf("upstream must never be dialed for an oversized body")
	}
}

// 8. Header hygiene: upstream fake asserts it received ONLY Content-Type,
// Accept, Authorization (+ the handful of headers net/http's own Transport
// adds unconditionally, which are not a caller-controlled passthrough) — no
// cookies, no x-forwarded-*, nothing else from an inbound request. And
// Authorization equals the bearer ARG, proving it came from the header path,
// not the body.
func TestInvoke_HeaderHygiene_OnlyContentTypeAcceptAuthorizationReachUpstream(t *testing.T) {
	t.Parallel()
	netHTTPPlumbing := map[string]bool{
		"User-Agent":      true, // set by net/http.Transport when unset, not by Invoke
		"Accept-Encoding": true, // set by net/http.Transport when unset, not by Invoke
		"Content-Length":  true, // wire framing, not a header choice
	}
	relayed := map[string]bool{"Content-Type": true, "Accept": true, "Authorization": true}

	var gotHeaders http.Header
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	const bearerArg = "Bearer the-callers-own-token"
	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	if _, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{
		Method:      "POST",
		Path:        "/chat",
		ContentType: "application/json",
		Body:        []byte(`{}`),
	}, bearerArg); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for k := range gotHeaders {
		if !relayed[k] && !netHTTPPlumbing[k] {
			t.Fatalf("upstream received unexpected header %q — only Content-Type/Accept/Authorization may reach it", k)
		}
	}
	if got := gotHeaders.Get("Authorization"); got != bearerArg {
		t.Fatalf("want Authorization == bearer arg %q, got %q — must come from the header path, not the body", bearerArg, got)
	}
	if gotHeaders.Get("Accept") == "" {
		t.Fatalf("want Accept set on the relayed request")
	}
}

// 9. Bearer empty -> still relays with no Authorization header (the gateway
// answers 401; the tester shows it) — the proxy adds no auth of its own.
func TestInvoke_EmptyBearer_RelaysWithNoAuthorizationHeaderOfItsOwn(t *testing.T) {
	t.Parallel()
	var authPresent bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, authPresent = r.Header["Authorization"]
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	result, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: "/x"}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authPresent {
		t.Fatalf("proxy must add no Authorization header of its own when bearer is empty")
	}
	if result.Status != http.StatusUnauthorized {
		t.Fatalf("want the upstream's own 401 relayed, got %d", result.Status)
	}
}

// 10. Timeout: upstream sleeps past the deadline -> context deadline error
// surfaced as ErrUpstreamTimeout (504). Uses a short injected timeout (the
// service struct's invokeTimeout field), not the 60s default.
func TestInvoke_UpstreamTimeout_ErrUpstreamTimeout(t *testing.T) {
	t.Parallel()
	block := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-block
	}))
	t.Cleanup(func() {
		close(block)
		upstream.Close()
	})

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 20*time.Millisecond)
	_, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: "/x"}, "")
	if !errors.Is(err, ErrUpstreamTimeout) {
		t.Fatalf("want ErrUpstreamTimeout, got %v", err)
	}
}

// 11. A redirect is the component's ANSWER, never an instruction this relay
// obeys. validateInvokePath runs once, before the request — a followed 3xx
// would take the next hop to an address nothing ever checked, with the
// caller's bearer attached. That is SSRF with our own credentials: a
// component (or anything that can shape its response) points Location at
// 169.254.169.254 or an in-cluster service, and the relay fetches it and
// hands the body back. So the 3xx is relayed verbatim and the secondary
// server must never be touched.
func TestInvoke_RedirectIsRelayedNotFollowed(t *testing.T) {
	t.Parallel()
	var secondaryHits int32
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&secondaryHits, 1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("SECRET-INTERNAL-DATA"))
	}))
	defer secondary.Close()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", secondary.URL+"/latest/meta-data/")
		w.WriteHeader(http.StatusFound)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	result, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent",
		InvokeCall{Method: "GET", Path: "/x"}, "Bearer caller-token")
	if err != nil {
		t.Fatalf("a 3xx is a relayable answer, not a relay failure: %v", err)
	}
	if got := atomic.LoadInt32(&secondaryHits); got != 0 {
		t.Fatalf("relay followed the redirect and fetched the secondary server %d time(s) — SSRF", got)
	}
	if result.Status != http.StatusFound {
		t.Fatalf("want the 302 relayed verbatim, got %d", result.Status)
	}
	if strings.Contains(string(result.Body), "SECRET-INTERNAL-DATA") {
		t.Fatal("relay returned the redirect target's body — it followed the redirect")
	}
}

// 12. Percent-encoded (and double-percent-encoded) traversal, protocol-relative
// paths, and encoded-slash traversal must all be rejected the same as literal
// "..": validateInvokePath decodes before checking, repeatedly (bounded), so
// %2e%2e / %2E%2E / %252e%252e / a%2f..%2fb style bypasses cannot slip past a
// naive strings.Contains(p, "..") substring check. Assert the upstream fake
// is NEVER dialed for any of these.
func TestInvoke_EncodedTraversalAndProtocolRelative_RejectedWithoutTouchingUpstream(t *testing.T) {
	t.Parallel()
	hit := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	bad := []string{
		"/%2e%2e/other",
		"/%2E%2E/other",
		"/%252e%252e/other",
		"/a/../../b",
		"//evil.com/x",
		"/a/..%2fb",
	}
	for _, p := range bad {
		if _, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: p}, ""); !errors.Is(err, ErrBadPath) {
			t.Fatalf("path %q: want ErrBadPath, got %v", p, err)
		}
	}
	if hit {
		t.Fatalf("upstream must never be dialed for a rejected path")
	}
}

// 13. Paths that merely LOOK suspicious to a naive check must still be
// accepted: a legitimate query string containing "/../" is not a path
// escape (traversal only in the query), and a filename with literal dots
// ("report..v2.json") is not a traversal segment.
func TestInvoke_LookalikeSafePaths_StillAccepted(t *testing.T) {
	t.Parallel()
	var gotPaths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPaths = append(gotPaths, r.URL.RequestURI())
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 0)
	ok := []string{
		"/chat",
		"/api/v1/items/",
		"/search?q=a/../b",
		"/report..v2.json",
	}
	for _, p := range ok {
		if _, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: p}, ""); err != nil {
			t.Fatalf("path %q: want it accepted, got %v", p, err)
		}
	}
	if len(gotPaths) != len(ok) {
		t.Fatalf("want upstream dialed once per accepted path, got %d hits for %d paths", len(gotPaths), len(ok))
	}
}

// 14. A timeout that happens DURING the body read (headers already sent,
// partial body flushed, then the upstream blocks past the deadline) must
// still map to ErrUpstreamTimeout, not a generic wrapped error — the
// deadline is shared between client.Do and the following io.ReadAll, and
// the body-read error branch must check for it too.
func TestInvoke_TimeoutDuringBodyRead_ErrUpstreamTimeout(t *testing.T) {
	t.Parallel()
	block := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"partial":`))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-block
	}))
	t.Cleanup(func() {
		close(block)
		upstream.Close()
	})

	svc := invokeTestSvc(t, designFiles("chat-agent", "ai-agent", ""), upstream.URL, 50*time.Millisecond)
	_, err := svc.Invoke(context.Background(), "acme", "web", "chat-agent", InvokeCall{Method: "GET", Path: "/x"}, "")
	if !errors.Is(err, ErrUpstreamTimeout) {
		t.Fatalf("want ErrUpstreamTimeout for a deadline hit during body read, got %v", err)
	}
}
