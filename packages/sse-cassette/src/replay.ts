/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Replay side of the cassette framework.
 *
 * - `cassetteToStream` — the recorded response body as a
 *   `ReadableStream<Uint8Array>`, preserving recorded chunk boundaries and
 *   (scaled) inter-chunk delays. Feed it straight into a stream consumer under
 *   test. `rechunk` re-splits the same bytes at seeded-random boundaries to
 *   fuzz cross-chunk buffering (including mid-multibyte splits) — a correct
 *   consumer must produce identical results for any chunking.
 * - `serveCassettes` — a real HTTP server that answers matched requests with
 *   the recorded status/headers/chunks and timing: the "mock agent" endpoint
 *   for tests and for pointing a live console at (`API_PROXY_TARGET`).
 */

import http from "node:http";
import { once } from "node:events";
import { cassetteBytes, loadCassettes, type Cassette } from "./cassette.js";

export interface RechunkOptions {
  /** Seed for the deterministic chunk-size generator. */
  seed: number;
  /** Minimum bytes per chunk (default 1). */
  minBytes?: number;
  /** Maximum bytes per chunk (default 64). */
  maxBytes?: number;
}

export interface ReplayOptions {
  /**
   * Multiplier on recorded delays. 0 (default) replays as fast as possible
   * while preserving chunk boundaries; 1 reproduces the recorded pacing.
   */
  timeScale?: number;
  /** Re-split the recorded bytes at seeded-random boundaries. */
  rechunk?: RechunkOptions;
}

interface TimedChunk {
  tMs: number;
  bytes: Uint8Array;
}

/** mulberry32 — tiny deterministic PRNG; identical seed ⇒ identical chunking. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The cassette's byte stream as timed chunks — either the recorded boundaries
 * verbatim, or a seeded re-split. A re-split chunk inherits the timestamp of
 * the recorded chunk its first byte came from, so pacing stays realistic.
 */
export function timedChunks(cassette: Cassette, rechunk?: RechunkOptions): TimedChunk[] {
  if (!rechunk) {
    return cassette.chunks.map((c) => ({
      tMs: c.tMs,
      bytes: new Uint8Array(Buffer.from(c.b64, "base64")),
    }));
  }

  const bytes = cassetteBytes(cassette);
  // Offset → timestamp of the recorded chunk that byte belonged to.
  const offsets: { start: number; tMs: number }[] = [];
  let pos = 0;
  for (const c of cassette.chunks) {
    offsets.push({ start: pos, tMs: c.tMs });
    pos += Buffer.from(c.b64, "base64").length;
  }
  const tsForOffset = (offset: number): number => {
    let t = 0;
    for (const o of offsets) {
      if (o.start > offset) break;
      t = o.tMs;
    }
    return t;
  };

  const rand = mulberry32(rechunk.seed);
  const min = Math.max(1, rechunk.minBytes ?? 1);
  const max = Math.max(min, rechunk.maxBytes ?? 64);
  const out: TimedChunk[] = [];
  let at = 0;
  while (at < bytes.length) {
    const size = min + Math.floor(rand() * (max - min + 1));
    out.push({ tMs: tsForOffset(at), bytes: bytes.slice(at, at + size) });
    at += size;
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The recorded response body as a timed `ReadableStream<Uint8Array>`. */
export function cassetteToStream(
  cassette: Cassette,
  opts: ReplayOptions = {},
): ReadableStream<Uint8Array> {
  const timeScale = opts.timeScale ?? 0;
  const chunks = timedChunks(cassette, opts.rechunk);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let prev = 0;
      for (const chunk of chunks) {
        const wait = (chunk.tMs - prev) * timeScale;
        prev = chunk.tMs;
        if (wait > 0) await sleep(wait);
        controller.enqueue(chunk.bytes);
      }
      controller.close();
    },
  });
}

export interface ServeCassettesOptions {
  /** Cassettes to serve (or use `dir`). */
  cassettes?: Cassette[];
  /** Directory of cassette JSON files (sorted by filename). */
  dir?: string;
  /** 0 to listen on an ephemeral port (default). */
  port?: number;
  /** Default 1 — reproduce recorded pacing for in-browser repro. */
  timeScale?: number;
  /**
   * Proxy unmatched requests to this origin instead of 404ing. Lets a REAL
   * browser session run against replay: auth/pages/files hit the live BFF,
   * while the recorded turn streams replay deterministically.
   */
  fallbackTarget?: string;
  log?: (line: string) => void;
}

export interface CassetteServer {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** Response headers that only make sense on the original connection. */
const SKIP_REPLAY_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "date"]);

/**
 * Volatile path segments (conversation/session UUIDs and similar long ids)
 * differ on every live run, so replay matching wildcards them.
 */
function normalizePath(path: string): string {
  return path
    .split("?")[0]!
    .split("/")
    .map((seg) =>
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg) ||
      /^[A-Za-z0-9_-]{24,}$/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
}

const useCaseOf = (body: unknown): string =>
  body && typeof body === "object" && typeof (body as { useCase?: unknown }).useCase === "string"
    ? ((body as { useCase: string }).useCase)
    : "";

const matchKey = (method: string, path: string, useCase: string): string =>
  `${method} ${normalizePath(path)}${useCase ? ` [${useCase}]` : ""}`;

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

/** Plain streaming reverse-proxy for unmatched requests (fallbackTarget mode). */
function forward(
  target: string,
  req: http.IncomingMessage,
  body: Buffer,
  res: http.ServerResponse,
): void {
  const origin = new URL(target);
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (key === "host" || key === "content-length" || key === "accept-encoding") continue;
    headers[key] = v;
  }
  if (body.length > 0) headers["content-length"] = String(body.length);
  const upstream = http.request(
    {
      host: origin.hostname,
      port: origin.port,
      path: req.url ?? "/",
      method: req.method,
      headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      res.flushHeaders();
      upRes.on("data", (chunk: Buffer) => res.write(chunk));
      upRes.on("end", () => res.end());
      upRes.on("error", () => res.destroy());
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`replay fallback: upstream error: ${err.message}`);
  });
  upstream.end(body);
}

/**
 * Serve cassettes over real HTTP. Requests match on method + path (volatile
 * id segments wildcarded) + the JSON body's `useCase` when present — so a
 * fresh conversation UUID still hits the recorded turn of the same kind.
 * Multiple recordings under one key are served in recorded order (the last
 * one repeats). Unmatched requests get a 404 listing what's loaded.
 */
export async function serveCassettes(opts: ServeCassettesOptions): Promise<CassetteServer> {
  const cassettes = [...(opts.cassettes ?? []), ...(opts.dir ? loadCassettes(opts.dir) : [])];
  const queues = new Map<string, Cassette[]>();
  for (const c of cassettes) {
    const key = matchKey(c.request.method, c.request.path, useCaseOf(c.request.body));
    const queue = queues.get(key) ?? [];
    queue.push(c);
    queues.set(key, queue);
  }
  const timeScale = opts.timeScale ?? 1;

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body.toString("utf8"));
    } catch {
      parsedBody = undefined;
    }
    const key = matchKey(req.method ?? "GET", req.url ?? "/", useCaseOf(parsedBody));
    const queue = queues.get(key);
    const cassette = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!cassette) {
      if (opts.fallbackTarget) {
        forward(opts.fallbackTarget, req, body, res);
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: "no cassette", request: key, loaded: [...queues.keys()] }),
      );
      return;
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(cassette.response.headers)) {
      if (!SKIP_REPLAY_HEADERS.has(k.toLowerCase())) headers[k] = v;
    }
    res.writeHead(cassette.response.status, headers);
    res.flushHeaders();
    opts.log?.(`replaying ${key} (${cassette.chunks.length} chunks, timeScale=${timeScale})`);

    let prev = 0;
    for (const chunk of cassette.chunks) {
      const wait = (chunk.tMs - prev) * timeScale;
      prev = chunk.tMs;
      if (wait > 0) await sleep(wait);
      if (res.destroyed) return;
      res.write(Buffer.from(chunk.b64, "base64"));
    }
    res.end();
  });

  server.listen(opts.port ?? 0);
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
  return {
    server,
    port,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
