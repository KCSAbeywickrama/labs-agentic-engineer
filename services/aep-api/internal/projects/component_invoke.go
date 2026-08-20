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

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
	"github.com/wso2/aep/aep-api/internal/spec"
)

const (
	// invokeMaxRequestBody caps the relayed request body. The Test tab sends
	// small JSON payloads (a chat turn, a tool call); this is a guard against
	// the route being used as a generic upload endpoint.
	invokeMaxRequestBody = 256 << 10 // 256 KiB

	// invokeMaxResponseBody caps how much of the upstream response is read
	// into memory. Large enough for a real chat/tool response, small enough
	// that a runaway or malicious upstream cannot pin the BFF's memory.
	invokeMaxResponseBody = 1 << 20 // 1 MiB

	// invokeDefaultTimeout bounds how long the BFF waits on the caller's
	// behalf. Overridable per componentService instance (invokeTimeout field)
	// for tests.
	invokeDefaultTimeout = 60 * time.Second
)

// InvokeCall is one HTTP call to relay to a deployed component's own gateway
// URL, as the caller. It is the domain shape of the contract's InvokeRequest.
// Body is the request body as raw bytes; the contract carries it as a plain
// JSON string, so it is UTF-8 text on the wire and a binary body is not
// representable today.
type InvokeCall struct {
	Method      string
	Path        string
	ContentType string
	Body        []byte
}

// InvokeResult is the upstream component's raw response, relayed verbatim.
// Status is the UPSTREAM status: Invoke itself only fails (non-nil error) when
// the relay could not happen at all (component not found, path rejected, no
// reachable deployment, request too large, or a timeout) — an upstream 401,
// 404, or 500 is a successful relay that carries that status.
type InvokeResult struct {
	Status      int
	ContentType string
	Body        []byte
	Truncated   bool
}

// Invoke relays one call to componentName's deployed gateway URL, as the
// caller. This is the whole reason the route exists: the console's Test tab
// runs in the browser, and CORS/credential handling means it cannot call a
// service's gateway directly, so the BFF makes the one call on the browser's
// behalf, with the browser's own bearer.
//
// It is deliberately NOT a general egress proxy — every guardrail below is
// load-bearing:
//
//   - Project scoping: componentName must appear in the CALLER'S OWN project
//     design, or this 404s before any network egress happens at all. Any
//     component type is invokable (unlike GetComponentOpenAPI, which is
//     service-only) — an ai-agent today, a service later for the API tester.
//   - Path guardrails (validateInvokePath) reject anything that could turn
//     `path` into "fetch an arbitrary URL": absolute URLs, `..` traversal,
//     scheme-relative `//`. Without this, `path` plus the gateway base URL
//     join would be a generic SSRF-capable fetch, not a scoped relay.
//   - No header passthrough: only Content-Type/Accept/Authorization are ever
//     sent upstream. The inbound console request's cookies, x-forwarded-*,
//     etc. never reach the upstream component — Invoke builds the outbound
//     request from scratch (method/path/contentType/body/bearer), it never
//     forwards a *http.Request.
//   - The caller's own bearer is forwarded exactly as given; the relay never
//     mints, substitutes, or upgrades its own credential. An empty bearer
//     relays with no Authorization header at all — the upstream gateway then
//     answers 401 on its own terms, which the tester shows the caller.
//   - Request/response size caps bound the BFF's own memory and the upstream
//     call's duration (invokeDefaultTimeout), so this route cannot become an
//     amplification or resource-exhaustion vector.
func (s *componentService) Invoke(ctx context.Context, orgName, projectName, componentName string, in InvokeCall, bearer string) (InvokeResult, error) {
	if s.artifactStore == nil {
		return InvokeResult{}, fmt.Errorf("invoke: artifact store not configured")
	}
	if err := s.invokeComponentInDesign(ctx, orgName, projectName, componentName); err != nil {
		return InvokeResult{}, err
	}

	if len(in.Body) > invokeMaxRequestBody {
		return InvokeResult{}, ErrBodyTooLarge
	}
	if err := validateInvokePath(in.Path); err != nil {
		return InvokeResult{}, err
	}

	baseURL, err := s.firstDeploymentEndpoint(ctx, orgName, projectName, componentName)
	if err != nil {
		return InvokeResult{}, err
	}

	timeout := s.invokeTimeout
	if timeout <= 0 {
		timeout = invokeDefaultTimeout
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	upstreamURL := strings.TrimRight(baseURL, "/") + in.Path

	var bodyReader io.Reader
	if len(in.Body) > 0 {
		bodyReader = bytes.NewReader(in.Body)
	}
	req, err := http.NewRequestWithContext(reqCtx, in.Method, upstreamURL, bodyReader)
	if err != nil {
		return InvokeResult{}, fmt.Errorf("invoke: build upstream request: %w", err)
	}
	// Only these three headers are ever set on the outbound request — see the
	// "no header passthrough" guardrail on the doc comment above.
	if in.ContentType != "" {
		req.Header.Set("Content-Type", in.ContentType)
	}
	req.Header.Set("Accept", "*/*")
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}

	// A 3xx is the component's ANSWER, never an instruction this relay obeys.
	// validateInvokePath runs once, above, against the path the caller asked
	// for; following a redirect would send the next hop to an address nothing
	// ever checked — with the caller's bearer still attached on a same-host
	// hop. That is SSRF using our own credentials: anything that can shape a
	// component's response points Location at the cloud metadata endpoint or
	// an in-cluster service, and the relay fetches it and hands back the body.
	// ErrUseLastResponse stops at the 3xx and relays it verbatim, which is
	// also what "the upstream's answer, relayed" already means everywhere
	// else here. The client is built here rather than shared so nothing can
	// hand this call a client that opts out of the policy.
	client := http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(reqCtx.Err(), context.DeadlineExceeded) {
			return InvokeResult{}, ErrUpstreamTimeout
		}
		return InvokeResult{}, fmt.Errorf("invoke: upstream call failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Read one byte past the cap so an exactly-at-cap response is not
	// mistaken for truncated.
	body, err := io.ReadAll(io.LimitReader(resp.Body, invokeMaxResponseBody+1))
	if err != nil {
		// The body read shares reqCtx's deadline with client.Do above: a slow
		// upstream that sends headers, flushes a partial body, then stalls
		// hits the SAME deadline here, just later. Map it to the same
		// ErrUpstreamTimeout rather than falling through to a generic 500.
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(reqCtx.Err(), context.DeadlineExceeded) {
			return InvokeResult{}, ErrUpstreamTimeout
		}
		return InvokeResult{}, fmt.Errorf("invoke: read upstream body: %w", err)
	}
	truncated := false
	if len(body) > invokeMaxResponseBody {
		body = body[:invokeMaxResponseBody]
		truncated = true
		// The cut lands on a byte boundary, but Body leaves here as a Go
		// string in a JSON field, and encoding/json replaces an invalid byte
		// with U+FFFD. A multi-byte rune straddling the cap would therefore
		// be corrupted rather than dropped — and at a 1 MiB cap on UTF-8 text
		// that is the common case, not the rare one. Back up to the last
		// complete rune so the body we hand back is exactly a prefix of what
		// the component sent.
		for len(body) > 0 && !utf8.Valid(body[max(0, len(body)-utf8.UTFMax):]) {
			body = body[:len(body)-1]
		}
	}

	return InvokeResult{
		Status:      resp.StatusCode,
		ContentType: resp.Header.Get("Content-Type"),
		Body:        body,
		Truncated:   truncated,
	}, nil
}

// invokeComponentInDesign is Invoke's project-scoping guardrail: componentName
// must appear in the caller's own project design, matched the same way
// GetComponentOpenAPI matches it (k8sname.ToK8sName(c.Name) == the URL's
// already-k8s-shaped componentName). Unlike GetComponentOpenAPI, every
// component type is accepted — Invoke is not service-only.
func (s *componentService) invokeComponentInDesign(ctx context.Context, orgName, projectName, componentName string) error {
	design, err := s.artifactStore.ReadDesign(ctx, orgName, projectName)
	if err != nil {
		if spec.IsNotFound(err) {
			return ErrComponentNotFound
		}
		return fmt.Errorf("invoke: read design: %w", err)
	}
	if design == nil {
		return ErrComponentNotFound
	}
	for _, c := range design.Components {
		if k8sname.ToK8sName(c.Name) == componentName {
			return nil
		}
	}
	return ErrComponentNotFound
}

// firstDeploymentEndpoint is the URL source: the first non-empty
// EndpointURL among the component's deployments. None found (no deployment,
// or every deployment lacks a gateway route — e.g. an intranet-only service)
// is reported as ErrNotReachable, not an error: it is an honest "this
// component has no gateway to invoke right now," not a platform failure.
func (s *componentService) firstDeploymentEndpoint(ctx context.Context, orgName, projectName, componentName string) (string, error) {
	list, err := s.client.ListDeployments(ctx, orgName, projectName, componentName)
	if err != nil {
		return "", fmt.Errorf("invoke: list deployments: %w", err)
	}
	if list != nil {
		for _, d := range list.Items {
			if d.EndpointURL != "" {
				return d.EndpointURL, nil
			}
		}
	}
	return "", ErrNotReachable
}

// invokePathDecodeMaxPasses bounds the repeated percent-decoding in
// validateInvokePath. Two passes is enough to unwrap double-encoding
// (%252e%252e -> %2e%2e -> ..); a third is headroom. Anything STILL encoded
// after the budget is rejected explicitly below — the budget is not itself a
// proof of exhaustion, which an earlier version of this comment wrongly
// claimed while `/%2525252e%2525252e/admin` sailed through.
const invokePathDecodeMaxPasses = 3

// validateInvokePath is the guardrail that keeps this route a scoped relay
// instead of a general egress proxy: path must be a plain absolute path
// joined onto the component's OWN gateway base URL, never a way to redirect
// the call elsewhere.
//
// Two different checks with two different scopes, and the split is the whole
// subtlety:
//
//   - WHOLE-STRING checks (valid UTF-8, no control character, no raw space)
//     run over the query too, because `in.Path` is concatenated onto the base
//     URL verbatim and therefore lands in the REQUEST LINE. A raw space is
//     enough: `/chat?x=1 HTTP/1.1` put `POST /agent/chat?x=1 HTTP/1.1
//     HTTP/1.1` on the wire, handing the caller control of the request line.
//     Restricting these to the path let the query smuggle it past.
//   - PATH-ONLY checks (traversal, scheme, scheme-relative) stop at the first
//     '?' or '#', so a legitimate query value (?redirect=http://x, ?q=a/../b)
//     is never mistaken for a path escape. Traversal inside a query reaches
//     only the query string the upstream itself interprets.
//
// The path is percent-decoded before the traversal check, repeatedly
// (bounded), because Go sends the path on the wire unchanged and a receiving
// gateway may normalise %2e%2e (or %252e%252e) before route matching — a
// literal strings.Contains(p, "..") does not see through that. A decode
// FAILURE is rejected rather than passed through, and so is anything still
// encoded once the budget runs out: both are paths this relay cannot reason
// about, and relaying what we cannot reason about is the whole bug class.
func validateInvokePath(p string) error {
	// Whole-string, query included — see the doc comment.
	if !utf8.ValidString(p) {
		return ErrBadPath
	}
	for _, r := range p {
		if unicode.IsControl(r) || r == ' ' {
			return ErrBadPath
		}
	}

	path := p
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}

	// A path that does not start with '/' is not a path: the caller-supplied
	// string is concatenated onto the base URL, so "evil.com/x" would produce
	// "https://gateway.exampleevil.com/x" — a host an attacker can register.
	if !strings.HasPrefix(path, "/") {
		return ErrBadPath
	}
	if strings.HasPrefix(path, "//") {
		return ErrBadPath
	}

	decoded := path
	for i := 0; i < invokePathDecodeMaxPasses; i++ {
		next, err := url.PathUnescape(decoded)
		if err != nil {
			return ErrBadPath
		}
		if next == decoded {
			break
		}
		decoded = next
	}
	// Still encoded after the budget: we do not know what a gateway will make
	// of it, so we refuse rather than guess.
	if again, err := url.PathUnescape(decoded); err != nil || again != decoded {
		return ErrBadPath
	}

	// Decoding can synthesise bytes the raw form never showed: %c0%ae is an
	// overlong "." and %2f an encoded "/". Re-run the byte checks and the
	// prefix checks on the DECODED form, or they only ever saw the disguise.
	if !utf8.ValidString(decoded) {
		return ErrBadPath
	}
	for _, r := range decoded {
		if unicode.IsControl(r) {
			return ErrBadPath
		}
	}
	if strings.HasPrefix(decoded, "//") || strings.Contains(decoded, "://") {
		return ErrBadPath
	}

	for _, seg := range strings.Split(decoded, "/") {
		// A path parameter (";" and after) is not part of the segment name:
		// some servers route "..;" as "..", so compare on the name alone.
		name, _, hasParam := strings.Cut(seg, ";")
		if seg == ".." || (hasParam && name == "..") {
			return ErrBadPath
		}
	}
	return nil
}
