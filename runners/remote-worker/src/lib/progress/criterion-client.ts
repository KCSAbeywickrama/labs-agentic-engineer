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

// Runner → platform client for the per-criterion validation callback. Models
// workspace.refreshGitToken: raw node http(s), Bearer + X-Correlation-ID, scheme
// branch, short timeout. Best-effort by contract — the durable store is a
// convenience for the finished-run view, never load-bearing for the run itself,
// so a failure here is logged and swallowed by the caller.

import http from "node:http";
import https from "node:https";

export interface CriterionClientConfig {
  platformURL: string;
  taskId: string;
  bearer: string;
  correlationId?: string;
}

export interface CriterionReport {
  criterionId: string;
  status: string;
  requirementId?: string;
}

// reportCriterion POSTs one criterion transition to the internal criteria
// callback. Resolves on a 2xx; rejects otherwise (the caller decides whether to
// swallow). A blank platformURL or bearer is a no-op resolve (dev / unauth runs).
export async function reportCriterion(
  cfg: CriterionClientConfig,
  report: CriterionReport,
): Promise<void> {
  if (!cfg.platformURL.trim() || !cfg.bearer.trim()) {
    return;
  }
  const base = cfg.platformURL.endsWith("/") ? cfg.platformURL.slice(0, -1) : cfg.platformURL;
  const url = new URL(`${base}/internal/v1/executions/${encodeURIComponent(cfg.taskId)}/validation-criteria`);

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${cfg.bearer.trim()}`,
    "Content-Type": "application/json",
  };
  if (cfg.correlationId) {
    headers["X-Correlation-ID"] = cfg.correlationId;
  }

  const body = JSON.stringify({
    criterionId: report.criterionId,
    status: report.status,
    ...(report.requirementId ? { requirementId: report.requirementId } : {}),
  });

  const lib = url.protocol === "https:" ? https : http;
  await new Promise<void>((resolve, reject) => {
    const hReq = lib.request(url, { method: "POST", headers, timeout: 5000 }, (res) => {
      // Drain so the socket frees; we only care about the status code.
      res.on("data", () => {});
      res.on("end", () => {
        const code = res.statusCode ?? 0;
        if (code >= 200 && code < 300) {
          resolve();
        } else {
          reject(new Error(`criteria callback returned ${code}`));
        }
      });
    });
    hReq.on("error", reject);
    hReq.on("timeout", () => {
      hReq.destroy();
      reject(new Error("criteria callback timed out"));
    });
    hReq.write(body);
    hReq.end();
  });
}
