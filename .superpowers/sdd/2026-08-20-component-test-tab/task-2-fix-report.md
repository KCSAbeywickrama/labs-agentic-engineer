# Task 2 fix report — component invoke relay security findings

Files touched:
- `services/aep-api/internal/projects/component_invoke.go`
- `services/aep-api/internal/projects/component_invoke_test.go`
- `services/aep-api/internal/projects/componentbuild/handler.go`
- `services/aep-api/internal/platform/apierr/apierr.go`

---
## Finding 1 — percent-encoded traversal bypasses the path guard

### Failing test (red)
Added `TestInvoke_EncodedTraversalAndProtocolRelative_RejectedWithoutTouchingUpstream`
and `TestInvoke_LookalikeSafePaths_StillAccepted` to
`component_invoke_test.go`. Before the fix:

```
=== NAME  TestInvoke_EncodedTraversalAndProtocolRelative_RejectedWithoutTouchingUpstream
    component_invoke_test.go:396: path "/%2e%2e/other": want ErrBadPath, got <nil>
--- FAIL: TestInvoke_EncodedTraversalAndProtocolRelative_RejectedWithoutTouchingUpstream (0.00s)

=== NAME  TestInvoke_LookalikeSafePaths_StillAccepted
    component_invoke_test.go:426: path "/search?q=a/../b": want it accepted, got invalid path: must be absolute and cannot escape the component's gateway
--- FAIL: TestInvoke_LookalikeSafePaths_StillAccepted (0.00s)
```

Both failed for the expected reason: the old `strings.Contains(p, "..")` /
`strings.Contains(p, "://")` checks operate on the raw string, so percent-encoded
traversal slips through, and the naive `://` and `..` substring checks over-reject
legitimate query strings.

### Fix
Rewrote `validateInvokePath` in `component_invoke.go`:
- Splits off the path portion (before the first `?`/`#`) before any check, so a
  legitimate query value is never mistaken for a path escape.
- Keeps the absolute-path and protocol-relative (`//`) checks on that portion.
- Percent-decodes with `net/url.PathUnescape`, repeatedly, bounded at
  `invokePathDecodeMaxPasses = 3` passes, stopping early once decoding is a
  no-op. A decode error rejects the path outright.
- Checks `://` on the fully decoded path (catches an encoded scheme too).
- Rejects the path only when a `/`-split SEGMENT equals `..` exactly — so
  `report..v2.json` (a filename) and a trailing slash are never falsely
  rejected.

### Green
```
--- PASS: TestInvoke_EncodedTraversalAndProtocolRelative_RejectedWithoutTouchingUpstream (0.00s)
--- PASS: TestInvoke_LookalikeSafePaths_StillAccepted (0.00s)
--- PASS: TestInvoke_BadPath_RejectedWithoutTouchingUpstream (0.00s)   (pre-existing, still passes)
```
Covers all required cases: `/%2e%2e/other`, `/%2E%2E/other`,
`/%252e%252e/other`, `/a/../../b`, `//evil.com/x`, `/a/..%2fb` rejected
without dialing upstream; `/chat`, `/api/v1/items/`, `/search?q=a/../b`,
`/report..v2.json` accepted and relayed.

---
## Finding 2 — timeout during body read mis-mapped to 500

### Failing test (red)
Added `TestInvoke_TimeoutDuringBodyRead_ErrUpstreamTimeout`: upstream writes
headers + a partial body, flushes, then blocks past the deadline.

```
=== NAME  TestInvoke_TimeoutDuringBodyRead_ErrUpstreamTimeout
    component_invoke_test.go:459: want ErrUpstreamTimeout for a deadline hit during body read, got invoke: read upstream body: context deadline exceeded
--- FAIL: TestInvoke_TimeoutDuringBodyRead_ErrUpstreamTimeout (0.05s)
```
Confirms the exact defect: the error reaches the generic
`fmt.Errorf("invoke: read upstream body: %w", err)` branch instead of
`ErrUpstreamTimeout`.

### Fix
In `Invoke`, the `io.ReadAll` error branch now also checks
`errors.Is(err, context.DeadlineExceeded) || errors.Is(reqCtx.Err(), context.DeadlineExceeded)`
and returns `ErrUpstreamTimeout` in that case, matching the `client.Do` branch
above it.

### Green
```
--- PASS: TestInvoke_TimeoutDuringBodyRead_ErrUpstreamTimeout (0.05s)
--- PASS: TestInvoke_UpstreamTimeout_ErrUpstreamTimeout (0.02s)   (pre-existing, still passes)
```

---
## Finding 3 — `CodeBadGateway` reused for a 504

`apierr` had no timeout-specific code (`bad_gateway` = 502 only; the only other
5xx code was `service_unavailable` = 503, semantically different — that one
means "we refuse to try," not "we tried and the upstream didn't answer in
time"). Added a distinct code:

```go
CodeGatewayTimeout = "gateway_timeout"
```

and changed `componentbuild/handler.go`'s `ErrUpstreamTimeout` mapping from
`apierr.New(http.StatusGatewayTimeout, apierr.CodeBadGateway, ...)` to
`apierr.New(http.StatusGatewayTimeout, apierr.CodeGatewayTimeout, ...)`.

**Decision:** adding the code is proportionate here — the review explicitly
flagged that a 504 carrying `bad_gateway` misleads a consumer trying to
distinguish 502 from 504, `apierr.go` already carries one code per status
family (`bad_request`, `not_found`, `conflict`, `bad_gateway`,
`service_unavailable`, …), and there was no pre-existing code that means
"upstream timed out" I could reuse without also being misleading. This is a
single new constant, not a parallel taxonomy — no duplication introduced.
`Code` is a plain string in the wire contract (`gen.Error.Code string`, no
enum), so this needed no contract change.

I did not touch `internal/edge/errors.go`'s parallel alias block
(`CodeBadGateway = apierr.CodeBadGateway`, etc.) — it is a separate
edge-owned alias surface for legacy edge-constructed errors and is not on the
path this handler uses (`componentbuild/handler.go` imports `apierr`
directly), so extending it wasn't required by this fix and I left it as I
found it to avoid an unrelated change.

---
## Already-fixed item verified (no action needed)
`TestInvoke_RedirectIsRelayedNotFollowed` was already present in
`component_invoke_test.go` and passes, covering the SSRF-via-redirect fix from
commit `9b8f10ec`. No changes made for this item, per the task's own note.

---
## Final verification
- `cd services/aep-api && gofmt -l internal/projects/ internal/platform/apierr/ internal/projects/componentbuild/`:
  ```
  internal/projects/usage_service.go
  ```
  Only the pre-existing, unrelated gofmt offender — none of the four files
  touched by this fix appear.
- `cd services/aep-api && go vet ./internal/projects/ ./internal/platform/apierr/`: no output (clean).
- `go test ./internal/projects/... -run 'TestInvoke' -v`: all 14 Invoke tests
  PASS (10 pre-existing + 4 new: `TestInvoke_EncodedTraversalAndProtocolRelative_RejectedWithoutTouchingUpstream`,
  `TestInvoke_LookalikeSafePaths_StillAccepted`,
  `TestInvoke_TimeoutDuringBodyRead_ErrUpstreamTimeout`, and confirmation of
  the pre-existing `TestInvoke_RedirectIsRelayedNotFollowed`).
- `go test ./...` from `services/aep-api`: 0 FAIL across the whole module
  (grep -c FAIL == 0).
- `make license-check` from repo root: exit 0, no output (clean).

No existing guardrail or test was weakened.
