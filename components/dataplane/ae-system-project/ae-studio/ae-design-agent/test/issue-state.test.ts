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
 * Whether an issue is open (`conversations/issue-state.ts`): read from its
 * `get_issue`, whose tool error says why by a code (`_meta["aep/code"]`),
 * never by its words.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { issueState } from "../src/conversations/issue-state.js";
import type { McpTransport } from "../src/shared/mcp-client.js";

/** A tools socket whose `get_issue` answers `result`. */
function answering(result: unknown): McpTransport {
  return {
    mcpFetch: (async (_path: unknown, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  };
}

const toolError = (text: string, code?: string) => ({
  content: [{ type: "text", text }],
  isError: true,
  ...(code ? { _meta: { "aep/code": code } } : {}),
});

test("issueState: open and closed as get_issue says", async () => {
  assert.equal(await issueState(answering({ content: [{ type: "text", text: '{"state":"open"}' }] }), "greeter", 7), "open");
  assert.equal(await issueState(answering({ content: [{ type: "text", text: '{"state":"closed"}' }] }), "greeter", 7), "closed");
});

test("issueState: no such issue, or no repository to hold one, is unknown by its code", async () => {
  assert.equal(await issueState(answering(toolError("anything at all", "issue_not_found")), "greeter", 7), "unknown");
  assert.equal(await issueState(answering(toolError("the project has no repository yet; nothing was done", "repo_not_found")), "greeter", 7), "unknown");
});

test("issueState: a tool error without a known code is no verdict, whatever its words say", async () => {
  await assert.rejects(issueState(answering(toolError("the issue was not found on the project's repository; nothing was done")), "greeter", 7));
  await assert.rejects(issueState(answering(toolError("could not read the issue right now; nothing was done", "unavailable")), "greeter", 7));
});
