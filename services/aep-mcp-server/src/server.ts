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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  AepApiError,
  type AepClientOptions,
  createIssue,
  dispatchFromIssue,
  listIssues,
} from "./aepClient.js";

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof AepApiError ? `aep-api ${err.status}: ${err.message}` : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}


/**
 * Builds an McpServer bound to one caller's bearer token. Called once per
 * incoming HTTP request (see main.ts) — this server holds no credentials or
 * state of its own; every tool call forwards `client.bearer` straight
 * through to aep-api, which performs the actual org-scoped auth check.
 */
export function createAepMcpServer(client: AepClientOptions): McpServer {
  const server = new McpServer({ name: "aep-mcp-server", version: "0.0.0" });

  server.registerTool(
    "ae_search_related_issues",
    {
      title: "Search related AE issues",
      description:
        "Search existing GitHub issues on a project's repo, to check for a duplicate before filing a new one.",
      inputSchema: {
        project: z.string().describe("OpenChoreo/AE project name"),
        query: z
          .string()
          .optional()
          .describe("Case-insensitive substring match against issue title/body"),
        labels: z.array(z.string()).optional().describe("Filter by GitHub labels"),
      },
    },
    async ({ project, query, labels }) => {
      try {
        // A conditional spread (rather than `{ query, labels }` directly) is
        // required under exactOptionalPropertyTypes: zod's optional args
        // destructure to `undefined` when absent, and explicitly assigning
        // `undefined` to an optional field is rejected — omitting the key
        // entirely is not.
        const issues = await listIssues(client, project, {
          ...(query !== undefined ? { query } : {}),
          ...(labels !== undefined ? { labels } : {}),
        });
        return textResult(issues);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ae_create_issue",
    {
      title: "Create a GitHub issue via AE",
      description:
        "Create a GitHub issue on a project's repo. Use this for a code-level fix that needs the AE coding agent — not for config-level changes.",
      inputSchema: {
        project: z.string().describe("OpenChoreo/AE project name"),
        title: z.string().describe("Issue title"),
        body: z.string().describe("Issue body (markdown)"),
        labels: z.array(z.string()).optional().describe("GitHub labels to apply"),
      },
    },
    async ({ project, title, body, labels }) => {
      try {
        const issue = await createIssue(client, project, {
          title,
          body,
          ...(labels !== undefined ? { labels } : {}),
        });
        return textResult(issue);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ae_dispatch_coding_agent",
    {
      title: "Dispatch the AE coding agent",
      description:
        "Create a task bound to an already-created GitHub issue and dispatch the AE coding agent against it. Call ae_create_issue first and pass its returned issue number/url here.",
      inputSchema: {
        project: z.string().describe("OpenChoreo/AE project name"),
        componentName: z
          .string()
          .describe("Component this issue is about (the alerting component's name)"),
        title: z.string().describe("Task title — reuse the issue title"),
        issueNumber: z.number().int().describe("GitHub issue number returned by ae_create_issue"),
        issueUrl: z.string().describe("GitHub issue URL returned by ae_create_issue"),
      },
    },
    async ({ project, componentName, title, issueNumber, issueUrl }) => {
      try {
        const result = await dispatchFromIssue(client, project, {
          componentName,
          title,
          issueNumber,
          issueUrl,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
