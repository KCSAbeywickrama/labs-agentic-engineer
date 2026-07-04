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
 * The reference SSE consumer — exactly what a browser fold is. POSTs one turn and
 * yields each raw `StreamPart` frame until `[DONE]`, buffered across chunk
 * boundaries. Each frame is a single physical line (`data: <json>`), since the
 * SDK `JSON.stringify`s each part (embedded newlines are escaped), so the only
 * real hazard is the cross-chunk buffering handled here. Comment frames
 * (`: keep-alive`) are skipped — they carry no data line.
 */

import { SSE_DONE, type TurnRequest } from "./contracts/sse-events.js";
import type { StreamPart } from "./stream-types.js";

// The turn-request body is the shared contract type (one definition, no drift).
export type { TurnRequest };

export interface StreamTurnOptions {
  /**
   * Extra request headers merged over `content-type`. The caller (BFF, eval,
   * playground) supplies the M2M `Authorization: Bearer <jwt>` and the
   * `X-Anthropic-Key` here — this reader is transport-only and holds no creds.
   */
  headers?: Record<string, string>;
}

/**
 * The raw frame parser, extracted so a caller that owns its own `fetch` (e.g. a
 * browser that must add auth headers, a custom request body shape, and its own
 * pre-stream HTTP-status error mapping) folds the SAME wire through ONE
 * definition instead of reimplementing the buffered `data:`/`[DONE]` loop.
 * Yields each `StreamPart` until `[DONE]`; skips keep-alive comment frames.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<StreamPart> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frames are delimited by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 2);
      if (!frame.startsWith("data:")) continue;
      const data = frame.slice("data:".length).trim();
      if (data === SSE_DONE) return;
      yield JSON.parse(data) as StreamPart;
    }
  }
}

export async function* streamTurn(
  baseUrl: string,
  id: string,
  body: TurnRequest,
  opts: StreamTurnOptions = {},
): AsyncIterable<StreamPart> {
  const res = await fetch(`${baseUrl}/conversations/${encodeURIComponent(id)}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", ...opts.headers },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`turn failed: HTTP ${res.status} ${text}`);
  }
  yield* parseSseStream(res.body);
}
