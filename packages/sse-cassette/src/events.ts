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
 * Cassette inspector: decode the recorded chunks back into the ordered SSE
 * event sequence. Chunks (network arrivals) and events (SSE frames) are
 * different sequences — one chunk can complete several frames and one frame
 * can span many chunks — so each event carries the chunk range it arrived
 * over and the arrival time of the chunk that COMPLETED it.
 */

import type { Cassette } from "./cassette.js";

export interface CassetteEvent {
  /** 0-based position in the event (frame) order. */
  index: number;
  /** `data` frame, `: comment` frame, or the `[DONE]` sentinel. */
  kind: "data" | "comment" | "done";
  /** The parsed part's `type` (data frames with valid JSON only). */
  type?: string;
  /** The parsed part (data frames with valid JSON only). */
  part?: Record<string, unknown>;
  /** Raw frame text (without the terminating blank line). */
  raw: string;
  /** Index of the chunk carrying the frame's first byte. */
  chunkStart: number;
  /** Index of the chunk that completed the frame (carried its `\n\n`). */
  chunkEnd: number;
  /** Arrival offset (ms) of the completing chunk — when the fold could act. */
  tMs: number;
}

/** Decode a cassette's chunks into the ordered SSE event list. */
export function cassetteEvents(cassette: Cassette): CassetteEvent[] {
  const decoder = new TextDecoder();
  const events: CassetteEvent[] = [];

  let buffer = "";
  // Chunk index that contributed each still-unconsumed char of `buffer`.
  let charChunk: number[] = [];

  for (let chunkIndex = 0; chunkIndex < cassette.chunks.length; chunkIndex++) {
    const { tMs, b64 } = cassette.chunks[chunkIndex]!;
    const text = decoder.decode(Buffer.from(b64, "base64"), { stream: true });
    buffer += text;
    for (let i = 0; i < text.length; i++) charChunk.push(chunkIndex);

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      const frameChunks = charChunk.slice(0, sep + 2);
      buffer = buffer.slice(sep + 2);
      charChunk = charChunk.slice(sep + 2);

      const raw = frame.trim();
      if (raw.length === 0) continue; // stray blank (e.g. truncation-marker padding)

      const chunkStart = frameChunks[0] ?? chunkIndex;
      const chunkEnd = frameChunks[frameChunks.length - 1] ?? chunkIndex;
      const completedAt = cassette.chunks[chunkEnd]?.tMs ?? tMs;

      const base = { index: events.length, raw, chunkStart, chunkEnd, tMs: completedAt };
      // A frame is a multi-line SSE record: the committed-truth BFF prefixes an
      // `id: <index>` line (Last-Event-ID resume) ahead of the `data:` line, so
      // reading the data payload means scanning the frame's lines, not requiring
      // the frame to START with `data:`. A frame with no data line (`: keep-alive`
      // comment, bare `id:`) is a comment. `raw` stays the full frame for
      // byte-faithful replay.
      const dataLines = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"));
      if (dataLines.length === 0) {
        events.push({ ...base, kind: "comment" });
        continue;
      }
      const data = dataLines
        .map((line) => line.slice("data:".length).replace(/^ /, ""))
        .join("\n")
        .trim();
      if (data === "[DONE]") {
        events.push({ ...base, kind: "done" });
        continue;
      }
      try {
        const part = JSON.parse(data) as Record<string, unknown>;
        events.push({
          ...base,
          kind: "data",
          ...(typeof part.type === "string" ? { type: part.type } : {}),
          part,
        });
      } catch {
        events.push({ ...base, kind: "data" }); // unparseable remnant — kept, unlabeled
      }
    }
  }
  return events;
}

/** One human-scannable line per event (the CLI's default rendering). */
export function formatEvent(e: CassetteEvent, previewChars = 60): string {
  const chunks = e.chunkStart === e.chunkEnd ? `${e.chunkEnd}` : `${e.chunkStart}–${e.chunkEnd}`;
  const label =
    e.kind === "done" ? "[DONE]" : e.kind === "comment" ? `comment ${e.raw}` : (e.type ?? "data(unparseable)");
  let detail = "";
  if (e.kind === "data" && e.part) {
    const p = e.part;
    const bits: string[] = [];
    if (typeof p.toolName === "string") bits.push(`tool=${p.toolName}`);
    const id = p.id ?? p.toolCallId;
    if (typeof id === "string") bits.push(`id=${id}`);
    const text = p.delta ?? p.text;
    if (typeof text === "string" && text.length > 0) {
      bits.push(`${typeof p.delta === "string" ? "delta" : "text"}=${JSON.stringify(text.slice(0, previewChars))}${text.length > previewChars ? "…" : ""}`);
    }
    if (typeof p.finishReason === "string") bits.push(`finishReason=${p.finishReason}`);
    detail = bits.length > 0 ? `  ${bits.join(" ")}` : "";
  }
  return `${String(e.index).padStart(4)}  ${String(e.tMs).padStart(7)}ms  chunk ${chunks.padEnd(9)} ${label}${detail}`;
}
