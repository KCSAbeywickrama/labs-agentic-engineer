# Composition seam — `app.Run(Options)`

How aep-api starts: one importable composition **seam**, two process entries
(OSS vs **overlay module**), and nil-able `Options` as the only deployment
behaviour differences.

## Shape

```
cmd/aep-api (OSS)          overlay module main
        \                     /
         \                   /
          v                 v
     app.Run(cfg, Options)     ← public package github.com/wso2/aep/aep-api/app
              |
              v
     internal/app.Resolve → Assemble(Seam) → HTTP + watchers + shutdown
```

`Run` owns resolve → assemble → degradation logs → HTTP serve (existing
timeouts) → background watchers under `async.Go` → signal shutdown. Callers do
not open the DB or wire the domain graph themselves.

## `Options` (the seam)

Every field documents its nil meaning. Nil is a **feature off-switch**: disable
cleanly, never panic, never silently swap credential class.

| Field | Role |
|---|---|
| `AuthProvider` | Bearer for `AuthModeServiceM2M` OC calls (`Token` / `Invalidate`) |
| `RequestAuthStrategy` | Pure per-request credential-class decision (`Decide(ctx) AuthMode`) |
| `ImpersonateOrgResolver` | Sets `X-Impersonate-Org` on M2M calls when non-nil |
| `ImpersonateOrgResolverBuilder` | Late-bound resolver after `Resolve` opens the DB; ignored if the resolver is already set |
| `SecretsProvider` | When non-nil, replaces default SM-API construction from `SECRET_MANAGER_API_URL` |

Compile-time `var _ openchoreo.RequestAuthStrategy = …` assertions keep seam
implementations honest.

## OpenChoreo transport

`internal/clients/openchoreo` consumes the injected `RequestAuthStrategy`. Nil
strategy = **direct-OC mode** off-switch (`AuthModeServiceM2M`, never
pass-through). Same-class M2M cache invalidate + retry on 401 is preserved;
strategies must not retry with a different credential class.

## Direct-OC mode (OSS)

`cmd/aep-api` wires:

- M2M `AuthProvider` when service-auth env is configured (else nil)
- `app.DirectOCStrategy{}` — always `AuthModeServiceM2M`
- `ImpersonateOrgResolver: nil` — no impersonation header

`PLATFORM_API_SERVICE_BASE_URL` points at OpenChoreo API directly.

## Overlay module + PAS strategy

An **overlay module** is a consumer of the public `app` package: its own `main`
builds `Options` and calls `Run`. Cloud-specific auth lives there as a **PAS
strategy** — a `RequestAuthStrategy` (plus impersonation resolver when needed)
that chooses user-JWT pass-through vs M2M + `X-Impersonate-Org` from request
context. The public tree keeps the seam contracts and the OSS direct-OC default;
it does not embed that dual-mode policy.
