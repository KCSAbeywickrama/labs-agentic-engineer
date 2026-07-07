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
 * Thin wrapper over aep-api's `/api/v1/projects/{projectName}/issues` and
 * `/api/v1/projects/{projectName}/tasks/dispatch-from-issue` endpoints
 * (services/aep-api/internal/feature/gitrepo/issue_huma.go and
 * .../task/task_huma.go). Every call forwards the caller's bearer as-is —
 * this server holds no credentials of its own; aep-api's org-scoped JWT
 * verification (humakit.OrgScopedInput) is the only auth boundary. See
 * AE-HANDOFF-DESIGN.md (openchoreo/agents/sre-agent) §4/§9.
 */

export interface AepClientOptions {
  baseUrl: string;
  bearer: string;
}

export interface IssueResult {
  number: number;
  url: string;
  nodeId: string;
  /** True when an open issue with the same dedupeKey already existed — number/url refer to that issue and nothing was created. */
  deduped?: boolean;
}

export interface IssueInfo {
  Number: number;
  Title: string;
  Body: string;
  URL: string;
  State: string;
  Labels: string[];
}

export class AepApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AepApiError";
  }
}

async function request<T>(
  opts: AepClientOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  // Built incrementally (rather than `body: body === undefined ? undefined : ...`)
  // because exactOptionalPropertyTypes rejects explicitly assigning `undefined`
  // to RequestInit's optional `body` — omitting the key entirely is required.
  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      authorization: opts.bearer,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${opts.baseUrl}/api/v1${path}`, init);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AepApiError(res.status, text || `aep-api request failed: ${res.status}`);
  }

  // 204 (no-content commands like unhold) and 202 (accepted-async commands
  // like promote-from-issue) both carry an empty body — Huma sends none for
  // an output type with no `Body` field, regardless of status code — so key
  // off actual content rather than a hardcoded status list.
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function createIssue(
  opts: AepClientOptions,
  project: string,
  req: { title: string; body: string; labels?: string[]; dedupeKey?: string },
): Promise<IssueResult> {
  return request<IssueResult>(opts, "POST", `/projects/${encodeURIComponent(project)}/issues`, req);
}

export function listIssues(
  opts: AepClientOptions,
  project: string,
  filters: { labels?: string[]; query?: string } = {},
): Promise<IssueInfo[]> {
  const params = new URLSearchParams();
  if (filters.labels?.length) params.set("labels", filters.labels.join(","));
  if (filters.query) params.set("q", filters.query);
  const qs = params.toString();
  const path = `/projects/${encodeURIComponent(project)}/issues${qs ? `?${qs}` : ""}`;
  return request<IssueInfo[]>(opts, "GET", path);
}

// Promotes an ad-hoc issue into a coding Task and dispatches it through the
// funnel. Async (202, empty body, see the request() comment above) — there is
// no synchronous run name anymore; the funnel dispatches out-of-band. title
// and issueUrl are accepted but unused: kept so ae_dispatch_coding_agent's
// tool contract doesn't need to change on the SRE agent side.
export function dispatchFromIssue(
  opts: AepClientOptions,
  project: string,
  req: { componentName: string; title: string; issueNumber: number; issueUrl: string },
): Promise<void> {
  return request<void>(
    opts,
    "POST",
    `/projects/${encodeURIComponent(project)}/tasks/${req.issueNumber}/promote-from-issue`,
    { componentName: req.componentName },
  );
}
