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

// Per-task skills pull — runner-side client for
// GET $AEP_PLATFORM_URL/internal/v1/executions/{id}/skills.
//
// The {id} is the runner's AEP_TASK_ID, which the BFF job template now stamps
// with the coding Execution's id. The env var and the bearer's task claim keep
// the `task` name by contract (cluster workflow + runner bind those names); only
// the URL path is execution-keyed. See the phase-2 tasks-github-native re-key
// (docs/design/tasks-github-native.md §9.2).
//
// Auth: the RS256 runner bearer the runner already holds — the same bearer that
// authorizes the credentials-refresh and verification-failed callbacks. Returns
// the resolved SKILL.md bodies + materialised names to feed into the AgentSkills
// plugin tree under .aep/skills-plugin/.
//
// See docs/design/skills-system.md > "Coding agent".

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export interface SkillResolution {
  id: string;               // e.g. "builtin/api-management"
  materializedName: string; // e.g. "builtin-api-management"
  kind: "builtin" | "custom" | "imported";
  skillMd: string;
  references: Record<string, string>;
}

export interface SkillsPullResponse {
  skills: SkillResolution[];
}

export interface PullArgs {
  platformURL: string; // e.g. "http://aep-api:9090"
  taskId: string; // AEP_TASK_ID — now carries the execution id (URL is execution-keyed)
  bearer: string;
  correlationId?: string;
  timeoutMs?: number;
}

/**
 * Pull the resolved skills for this task's execution from the BFF. Empty list
 * (NOT an error) when the design has no attached skills. Throws on transport
 * failures, 4xx/5xx responses, or malformed bodies.
 */
export async function pullTaskSkills(args: PullArgs): Promise<SkillsPullResponse> {
  const base = new URL(args.platformURL);
  const url = new URL(`/internal/v1/executions/${encodeURIComponent(args.taskId)}/skills`, base);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.bearer.trim()}`,
    Accept: "application/json",
  };
  if (args.correlationId) {
    headers["X-Correlation-ID"] = args.correlationId;
  }

  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      { method: "GET", headers, timeout: args.timeoutMs ?? 10000 },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(
              new Error(
                `skills endpoint returned ${res.statusCode}: ${body.slice(0, 200)}`,
              ),
            );
          }
          try {
            const parsed = JSON.parse(body);
            // BFF wraps responses in { status, data } via WriteSuccessResponse.
            const data: unknown = parsed?.data ?? parsed;
            if (!data || typeof data !== "object" || !Array.isArray((data as { skills?: unknown }).skills)) {
              return reject(new Error("malformed skills response: missing skills[]"));
            }
            resolve(data as SkillsPullResponse);
          } catch (err) {
            reject(
              new Error(`invalid skills response: ${err instanceof Error ? err.message : String(err)}`),
            );
          }
        });
      },
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("skills request timed out"));
    });
    req.end();
  });
}

// Backoff (ms) between the 4 attempts — waited after attempts 1/2/3. Length + 1
// is the total attempt count.
const DEFAULT_BACKOFF_MS = [2000, 5000, 10000];

export interface RetryOptions {
  /** Delays (ms) between attempts. `length + 1` = total attempts. Default [2000, 5000, 10000]. */
  backoffMs?: number[];
  /** Injected for tests; defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to the real single-attempt `pullTaskSkills`. */
  attempt?: (args: PullArgs) => Promise<SkillsPullResponse>;
  /** Per-attempt log sink; defaults to console.warn. */
  log?: (line: string) => void;
}

/**
 * `pullTaskSkills` with bounded retry + backoff. A one-shot pod races the host
 * network on cold start (DNS/route to host.k3d.internal), so a single transient
 * 404 / ECONNREFUSED must not silently deprive the coding agent of its skills —
 * the identical request replayed a few seconds later succeeds. Retries on ANY
 * failure (network error OR non-200), backing off between attempts and logging
 * each outcome. First-attempt success adds zero latency. Throws the last error
 * only after every attempt is exhausted; the caller owns the fallback.
 */
export async function pullTaskSkillsWithRetry(
  args: PullArgs,
  opts: RetryOptions = {},
): Promise<SkillsPullResponse> {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempt = opts.attempt ?? pullTaskSkills;
  const log = opts.log ?? ((line) => console.warn(line));
  const total = backoff.length + 1;

  let lastErr: unknown;
  for (let i = 1; i <= total; i++) {
    try {
      const res = await attempt(args);
      if (i > 1) log(`[skills-pull] succeeded on attempt ${i}/${total}`);
      return res;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i < total) {
        const delay = backoff[i - 1];
        log(`[skills-pull] attempt ${i}/${total} failed (${msg}) — retrying in ${delay}ms`);
        await sleep(delay);
      } else {
        log(`[skills-pull] attempt ${i}/${total} failed (${msg}) — no retries left`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
