# SSE cassette record/replay testing (turn streams)

Status: shipped (2026-07-05). Packages: `@aep/sse-cassette`, console-legacy tests, `@aep/agent-stream`, aep-api genai.

## What this is

The generation flows (requirements-generate / requirements-chat / design-generate)
stream one SSE response of `StreamPart` frames through
agents-service → aep-api (`passThrough`, byte-verbatim) → console fold.
Streaming bugs live in the details a hand-written fixture never captures:
frames split across network chunks, multibyte characters split mid-encoding,
real per-token pacing, streams that die before `[DONE]`.

So tests replay **recorded production streams**: a recording reverse proxy
captures each `…/turns` exchange with the exact response byte chunks, their
boundaries, and inter-chunk delays; committed cassettes replay through the
exact browser fold in Node tests, or over real HTTP into a live browser.

## Cassette format (`@aep/sse-cassette`)

One JSON (or `.json.gz`) file per exchange:

```jsonc
{
  "version": 1,
  "recordedAt": "…",
  "request":  { "method", "path", "headers" /* authorization etc. redacted */, "body" /* incl. useCase + files seed */ },
  "response": { "status", "headers" },
  "chunks":   [ { "tMs": 312, "b64": "…" } ]  // exact bytes per network chunk, offset from first byte
}
```

The request body doubles as the test seed: `body.files` is the exact draft the
browser sent, so a fold replay starts from the same state production did.

## Recording

```sh
pnpm --filter @aep/sse-cassette record -- \
  --target http://localhost:9090 --port 9091 \
  --out console-legacy/console/test/fixtures/turns --match '/turns$'
API_PROXY_TARGET=http://localhost:9091 npx vite --port 8091 --strictPort   # in console-legacy/console
```

Drive the console normally (the proxy is streaming-transparent; every matched
exchange writes a cassette; secrets are scrubbed before disk). Local-dev
prerequisites for port 8091, already applied to the running cluster and
needed again after a cluster rebuild:
- Thunder `aep-console-client` needs `http://localhost:8091` in `redirectUris`
  (PUT via a `scope=system` token from `aep-system-client` — same recipe as
  `deployments/scripts/seed-test-users.sh`).
- Thunder `cors.allowed_origins` needs `http://localhost:8091`
  (`thunder-config-map` → rollout restart).
- `console-legacy/console/public/env-config.js` provides the dev-server
  runtime config (the docker image regenerates its own at container start).

Fixtures: gzip with `gzip -9 *.json` (the loader reads both forms).

## Replay

- **In tests** — `cassetteToStream(cassette, {timeScale, rechunk})` yields the
  recorded bytes as a `ReadableStream`. `timeScale: 0` (default) = boundary-
  faithful but instant; `rechunk: {seed,…}` re-splits the same bytes at
  seeded-random boundaries (fuzzes cross-chunk buffering, incl. mid-UTF-8 cuts).
  Chunk-slicing a cassette simulates a mid-turn disconnect.
- **In a browser** — `pnpm --filter @aep/sse-cassette serve -- --dir <fixtures>
  --port 9092 --time-scale 0.25 --fallback http://localhost:9090`, then run the
  console with `API_PROXY_TARGET=http://localhost:9092`. Turn requests match a
  cassette (method + path with volatile id segments wildcarded + body
  `useCase`) and replay with recorded pacing; everything else proxies to the
  live BFF. A recorded generation replays deterministically, token-free.

## Test suite (console-legacy/console/test/, `pnpm test` / `make test`)

Tests resolve `@aep/agent-stream`/`@aep/design-projection`/`@aep/sse-cassette`
from **source** via `tsconfig.test.json` paths (the island's `file:` deps are
hardlink copies whose `dist/` goes stale). The fold under test is
`foldTurnStream` (`src/services/api/turnStream.ts`) — extracted from `runTurn`
so it is transport-free and importable under Node (`config/env.ts` needs Vite).

- `foldTurnStream.test.ts` — synthetic frame-by-frame failure modes (disconnects,
  missing `tool-input-start`, in-band errors).
- `liveDesignOverlay.test.ts` — the tolerant live diagram projection contract.
- `turnCassettes.test.ts` — recorded-stream replays: every cassette folds to
  completion; requirements streams show progressive previews and match
  per-cassette goldens (`UPDATE_GOLDENS=1` regenerates); the design stream's
  diagram paints early / never vanishes / never regresses a settled component;
  a chunk-sliced stream reports `truncated`; seeded re-chunk replays fold
  byte-identically.

## Bugs this shipped with (all pinned by the tests above)

1. **Silent truncation** — a stream dying before `[DONE]` folded as clean
   success. Now: `parseSseStream` returns `'done' | 'eof'` (generator return
   value — non-breaking), `foldTurnStream` marks `truncated: true` and salvages
   the open partial file; BFF `passThrough` marks upstream read failures with a
   parser-invisible `: upstream-error` comment (an in-band `error` frame would
   have discarded the salvageable fold); unparseable truncation remnants are
   skipped, not thrown.
2. **Preview correlation** — the live typing preview required a
   `tool-input-start` with an id; now primes from the first `tool-input-delta`
   (`part.id ?? part.toolCallId`), with `editFile` inputs excluded.
3. **Cell-diagram flicker / default boxes** — during design-generate the page
   re-projected a brand-new diagram object per snapshot (a full re-layout up to
   ~12×/s: 528 re-renders over the recorded stream) and strict-parsed the one
   mid-write `design.json` (webapp painted as a default service box, regressed
   mid-stream: `service/0 → web-app/3 → service/0 → web-app/4`). Now the live
   branch of `ProjectArchitecturePage`'s projection goes through
   `lib/liveDesignOverlay.ts`: partial-JSON repair (real component types from
   the first frames), last-good-content fallback (no default-box regressions),
   identity-stable output (29 material updates instead of 528), never null once
   painted. Draft/historical branches keep the strict projection.
   `projectLiveDesign` additionally gates on the raw design.json inputs: the
   diagram is a pure function of component `design.json` files, so snapshots
   whose deltas land only in design.md/openapi.yaml/wireframes.dsl skip
   parsing and projection entirely (same object identity out).
   *Note:* the diagram appearing "late" was mostly generation order — the agent
   streamed `design.md` (~92 snapshots) before the first `design.json` byte;
   the design-generate steering + high-level-architecture skill now order the
   output design.md (3–5 lines) → every design.json → wireframes → openapi.
4. **Create-flow wedge (dev)** — StrictMode's double-mount aborted the only
   requirements bootstrap attempt and the page span forever.
   `ProjectRequirementsPage` now uses start-on-mount/abort-on-cleanup with the
   prompt captured once, and `bootstrapFromPrompt` has catch/finally with
   aborted-guards.

## Known follow-ups (out of scope here)

- Chat panel is mouse-unclickable under the requirements editor (z-index/layout).
- No error boundary around the lazy `@wso2/cell-diagram` import — a chunk-load
  failure blanks the whole app.
- `apps/console` `gen` (`tsr generate`) fails on Node 22.11 (router-cli CJS
  require of ESM chokidar@5) — pre-existing, breaks `make test`'s first step.
- Repo `make license-check` fails on tracked-but-deleted files of the current
  branch state (pre-existing).
- Task-plan streaming (`plan.ts`) shares `parseSseStream` but has no cassettes yet.
