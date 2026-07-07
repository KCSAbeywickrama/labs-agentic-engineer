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

import { test } from "node:test";
import assert from "node:assert/strict";
import { CASSETTE_VERSION, cassetteBytes, type Cassette } from "../src/cassette.js";
import { cassetteToStream, timedChunks } from "../src/replay.js";

function makeCassette(chunks: string[]): Cassette {
  return {
    version: CASSETTE_VERSION,
    recordedAt: "2026-01-01T00:00:00.000Z",
    request: { method: "POST", path: "/api/v1/x/turns", headers: {} },
    response: { status: 200, headers: { "content-type": "text/event-stream" } },
    chunks: chunks.map((s, i) => ({ tMs: i * 10, b64: Buffer.from(s, "utf8").toString("base64") })),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

test("cassetteToStream preserves recorded chunk boundaries and bytes", async () => {
  const cassette = makeCassette(["data: {\"a\":1}\n\n", "data: [DO", "NE]\n\n"]);
  const chunks = await readAll(cassetteToStream(cassette));
  assert.equal(chunks.length, 3);
  const text = Buffer.concat(chunks).toString("utf8");
  assert.equal(text, "data: {\"a\":1}\n\ndata: [DONE]\n\n");
});

test("timeScale=1 reproduces recorded pacing", async () => {
  const cassette = makeCassette(["a", "b", "c", "d", "e", "f"]); // 10ms apart → 50ms total
  const started = Date.now();
  await readAll(cassetteToStream(cassette, { timeScale: 1 }));
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 40, `expected ≥40ms of recorded pacing, got ${elapsed}ms`);
});

test("rechunk is deterministic per seed and preserves the byte stream", async () => {
  // Multibyte content — re-splitting MUST be able to cut through a UTF-8 char.
  const cassette = makeCassette(["data: {\"text\":\"héllo — wörld ✓✓✓\"}\n\n", "data: [DONE]\n\n"]);
  const a = timedChunks(cassette, { seed: 42, minBytes: 1, maxBytes: 3 });
  const b = timedChunks(cassette, { seed: 42, minBytes: 1, maxBytes: 3 });
  const c = timedChunks(cassette, { seed: 43, minBytes: 1, maxBytes: 3 });

  assert.deepEqual(
    a.map((x) => x.bytes.length),
    b.map((x) => x.bytes.length),
    "same seed ⇒ same chunking",
  );
  assert.notDeepEqual(
    a.map((x) => x.bytes.length),
    c.map((x) => x.bytes.length),
    "different seed ⇒ different chunking",
  );

  const original = Buffer.from(cassetteBytes(cassette));
  const reassembled = Buffer.concat(a.map((x) => Buffer.from(x.bytes)));
  assert.deepEqual(reassembled, original, "rechunking never alters the bytes");
  assert.ok(a.length > cassette.chunks.length, "1–3 byte chunks ⇒ many more chunks");

  // Timestamps stay monotonically non-decreasing after a re-split.
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i]!.tMs >= a[i - 1]!.tMs, "timestamps remain ordered");
  }
});

test("a streaming TextDecoder survives seeded mid-multibyte splits", async () => {
  const text = "✓ multi–byte: héllo wörld 🎉";
  const cassette = makeCassette([text]);
  const stream = cassetteToStream(cassette, { rechunk: { seed: 7, minBytes: 1, maxBytes: 2 } });
  const decoder = new TextDecoder();
  let out = "";
  for (const chunk of await readAll(stream)) out += decoder.decode(chunk, { stream: true });
  out += decoder.decode();
  assert.equal(out, text);
});
