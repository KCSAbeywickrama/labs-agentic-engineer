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
 * The recording reverse proxy. Sits between a client and a real origin
 * (console → aep-api during a live capture session), forwards every request
 * verbatim, and writes a cassette per matched exchange with the exact response
 * chunks and their arrival offsets. Streaming-transparent: each origin chunk
 * is flushed to the client the moment it arrives, so recording does not change
 * the timing being recorded.
 *
 * `accept-encoding` is stripped on the way upstream so bodies arrive (and are
 * recorded) uncompressed — chunk-level replay of a gzip stream would be
 * meaningless to tests.
 */

import http from "node:http";
import { join } from "node:path";
import { URL } from "node:url";
import {
  CASSETTE_VERSION,
  cassetteFilename,
  ensureDir,
  saveCassette,
  scrubHeaders,
  type Cassette,
} from "./cassette.js";

export interface RecordProxyOptions {
  /** Origin base URL, e.g. `http://localhost:9090`. */
  target: string;
  /** Directory cassettes are written into (created if missing). */
  outDir: string;
  /** Record only requests whose path matches; everything is still proxied. */
  match?: RegExp;
  /** Header names to redact in the stored cassette (defaults applied always). */
  scrubHeaders?: string[];
  /** Log a line per recorded cassette. */
  log?: (line: string) => void;
}

/** Hop-by-hop headers that must not be blindly forwarded. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardableHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || k === "accept-encoding" || k === "host") continue;
    out[k] = value;
  }
  return out;
}

function parseJsonBody(
  contentType: string | undefined,
  body: Buffer,
): { body?: unknown; bodyB64?: string } {
  if (body.length === 0) return {};
  if (contentType?.includes("application/json")) {
    try {
      return { body: JSON.parse(body.toString("utf8")) };
    } catch {
      /* fall through to raw */
    }
  }
  return { bodyB64: body.toString("base64") };
}

/**
 * Create (but do not listen on) the recording proxy server. Call
 * `.listen(port)` yourself, or use the CLI (`src/cli.ts record`).
 */
export function createRecordProxy(opts: RecordProxyOptions): http.Server {
  const target = new URL(opts.target);
  ensureDir(opts.outDir);
  let seq = 0;

  return http.createServer((req, res) => {
    const requestChunks: Buffer[] = [];
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: req.url ?? "/",
        method: req.method,
        headers: forwardableHeaders(req.headers),
      },
      (upRes) => {
        const t0 = Date.now();
        const responseChunks: { tMs: number; chunk: Buffer }[] = [];
        const record = opts.match ? opts.match.test(req.url ?? "") : true;

        const responseHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(upRes.headers)) {
          if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
          responseHeaders[key] = value;
        }
        res.writeHead(upRes.statusCode ?? 502, responseHeaders);
        res.flushHeaders();

        upRes.on("data", (chunk: Buffer) => {
          if (record) responseChunks.push({ tMs: Date.now() - t0, chunk });
          res.write(chunk);
        });
        upRes.on("end", () => {
          res.end();
          if (!record) return;
          seq += 1;
          const cassette: Cassette = {
            version: CASSETTE_VERSION,
            recordedAt: new Date().toISOString(),
            request: {
              method: req.method ?? "GET",
              path: req.url ?? "/",
              headers: scrubHeaders(req.headers, opts.scrubHeaders),
              ...parseJsonBody(req.headers["content-type"], Buffer.concat(requestChunks)),
            },
            response: {
              status: upRes.statusCode ?? 0,
              headers: scrubHeaders(upRes.headers, opts.scrubHeaders),
            },
            chunks: responseChunks.map(({ tMs, chunk }) => ({
              tMs,
              b64: chunk.toString("base64"),
            })),
          };
          const file = cassetteFilename(seq, cassette.request.method, cassette.request.path);
          saveCassette(join(opts.outDir, file), cassette);
          opts.log?.(
            `recorded ${file} (${cassette.chunks.length} chunks, ` +
              `${responseChunks.reduce((n, c) => n + c.chunk.length, 0)} bytes)`,
          );
        });
        upRes.on("error", () => res.destroy());
      },
    );

    upstream.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`record-proxy: upstream error: ${err.message}`);
    });

    req.on("data", (chunk: Buffer) => {
      requestChunks.push(chunk);
      upstream.write(chunk);
    });
    req.on("end", () => upstream.end());
    req.on("error", () => upstream.destroy());
  });
}
