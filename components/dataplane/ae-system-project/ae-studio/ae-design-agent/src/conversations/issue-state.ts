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
 * Whether an issue is open, read through its chat's own MCP route (the
 * issue's `get_issue`): an issue's chat has a thread only while its issue is
 * open, so the pod reads the issue before it opens or runs one.
 */

import { callMcpTool, mcpRoute, type McpTransport } from "../shared/mcp-client.js";

/** The MCP route of the Issues chat of `project`. */
export function issuesMcpPath(project: string): string {
  return `/projects/${encodeURIComponent(project)}/issues/mcp`;
}

/** The MCP route of the chat of issue `issueNumber` of `project`. */
export function issueMcpPath(project: string, issueNumber: number): string {
  return `/projects/${encodeURIComponent(project)}/issues/${issueNumber}/mcp`;
}

/**
 * The `get_issue` error codes (aep-api's `_meta["aep/code"]`) that are a
 * verdict: the repository holds no such issue (a pull request's number
 * included), or the project has no repository to hold one.
 */
const NO_SUCH_ISSUE = new Set(["issue_not_found", "repo_not_found"]);

/**
 * `open` or `closed` as the issue's `get_issue` says, `unknown` when the
 * project has no such issue (by the tool error's code, never its words).
 * Throws when the tools could not answer (the socket, aep-api or GitHub down,
 * or an error without such a code): no verdict on the issue.
 */
export async function issueState(tools: McpTransport, project: string, issueNumber: number): Promise<"open" | "closed" | "unknown"> {
  const { text, isError, code } = await callMcpTool(mcpRoute(tools, issueMcpPath(project, issueNumber)), "get_issue");
  if (isError) {
    if (code !== undefined && NO_SUCH_ISSUE.has(code)) return "unknown";
    throw new Error("get_issue failed");
  }
  let state: unknown;
  try {
    state = (JSON.parse(text) as { state?: unknown }).state;
  } catch {
    throw new Error("get_issue answered an unreadable issue");
  }
  return typeof state === "string" && state.toLowerCase() === "open" ? "open" : "closed";
}
