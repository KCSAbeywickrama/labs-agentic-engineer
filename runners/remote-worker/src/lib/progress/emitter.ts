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

// Single-owner stdout writer for runner progress NDJSON.
// All progress events flow through emit(); nothing else writes to stdout
// in the runner code path. Stamps ts + seq so callers can't forget,
// and routes every line through the scrubber.

import { scrubber } from "./scrubber.js";
import { PROGRESS_SCHEMA_VERSION, type ProgressEvent, type ProgressEventInput } from "./schema.js";

let seqCounter = 0;

export function emit(event: ProgressEventInput): void {
  seqCounter += 1;
  const enriched = {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    seq: seqCounter,
    ...event,
  } as ProgressEvent;
  process.stdout.write(JSON.stringify(scrubEventValues(enriched)) + "\n");
}

/**
 * Scrub each string VALUE, then serialize — never the other way round.
 *
 * Scrubbing the serialized line hands the scrubber JSON syntax as if it were
 * prose, and its header patterns end in `(\S+)`. `JSON.stringify` puts no
 * whitespace between fields, so on `…"summary":"curl -H authorization:TOK"}`
 * that `\S+` runs straight through `TOK"}` and swallows the closing quote and
 * brace: the line stops being JSON, the BFF's parseProgressLine falls back to
 * wrapping it as a raw `log` event, and the console prints the fragment. The
 * quieter half is worse — with fields after the match it eats those instead,
 * still parses, and silently drops toolUseId/emitterLabel, so the line loses
 * the attribution that groups it under its subagent.
 *
 * Values carry no JSON syntax, so a greedy match can only ever consume the
 * secret it was aimed at.
 */
function scrubEventValues(event: ProgressEvent): ProgressEvent {
  return scrubValue(event) as ProgressEvent;
}

// Walks the whole event rather than just its top level, so a nested string
// added to the schema later is scrubbed without anyone remembering to opt in.
function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubber.scrub(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v);
    return out;
  }
  return value;
}

export function primeScrubber(secrets: Iterable<string | undefined | null>): void {
  for (const s of secrets) scrubber.addLiteral(s ?? undefined);
}

// Test seam.
export function _resetEmitterForTesting(): void {
  seqCounter = 0;
  scrubber.reset();
}
