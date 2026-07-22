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

// Harness-side listener for per-criterion validation progress.
//
// The Playwright reporter runs inside the `npx playwright test` subprocess,
// whose stdout the agent SDK captures as a tool-result and drops — so it cannot
// reach the pod's NDJSON stdout, which is what feeds the live task-log stream.
// This listener bridges that gap: it binds a Unix socket the reporter POSTs each
// begin/end to, and fans each event out to TWO sinks —
//   1. emit() — the single stdout owner → pod stdout → live SSE (existing path);
//   2. the platform criteria callback → durable store the console reads back.
// Both are best-effort: a reporter or platform hiccup must never disturb the run.

import http from "node:http";
import { emit } from "./emitter.js";
import { reportCriterion, type CriterionClientConfig } from "./criterion-client.js";

export interface CriterionListener {
  socketPath: string;
  close: () => Promise<void>;
}

type CriterionStatus = "validating" | "passed" | "failed" | "skipped";

function normalizeStatus(s: unknown): CriterionStatus | undefined {
  switch (s) {
    case "validating":
    case "passed":
    case "failed":
    case "skipped":
      return s;
    default:
      return undefined;
  }
}

// startCriterionListener binds the Unix socket and starts fanning out events.
// `cfg` carries the platform coordinates for sink 2; when its platformURL/bearer
// is blank, sink 2 no-ops (sink 1 still emits).
export function startCriterionListener(
  socketPath: string,
  cfg: CriterionClientConfig,
): Promise<CriterionListener> {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
      // Guard against a runaway body — criterion payloads are tiny.
      if (raw.length > 64 * 1024) {
        req.destroy();
      }
    });
    req.on("end", () => {
      // Always ack immediately; delivery to the sinks is best-effort and async.
      res.writeHead(204).end();
      void handleReport(raw, cfg);
    });
    req.on("error", () => {});
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

async function handleReport(raw: string, cfg: CriterionClientConfig): Promise<void> {
  let parsed: { criterionId?: unknown; status?: unknown; requirementId?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // malformed line — ignore, never crash the harness
  }
  const criterionId = typeof parsed.criterionId === "string" ? parsed.criterionId.trim() : "";
  const status = normalizeStatus(parsed.status);
  const requirementId =
    typeof parsed.requirementId === "string" ? parsed.requirementId.trim() : "";
  if (!criterionId || !status) {
    return;
  }

  // Sink 1 — live stream (single stdout owner). Runs on this event loop, so it
  // can never interleave a partial line with the main run loop's emit().
  emit({
    kind: "criterion",
    step: criterionId,
    status,
    ...(requirementId ? { summary: requirementId } : {}),
  });

  // Sink 2 — durable store. Best-effort; a failure is logged (stderr, so it
  // never pollutes the NDJSON stdout stream) and swallowed.
  try {
    await reportCriterion(cfg, { criterionId, status, requirementId: requirementId || undefined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[criterion-listener] durable report failed (non-fatal): ${msg}`);
  }
}
