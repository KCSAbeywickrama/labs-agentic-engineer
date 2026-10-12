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

// The in-process ToolsSocket: what a test (or the playground) drives a turn
// with instead of ae-studio-tools. It answers the MCP JSON-RPC surface with
// the twelve design tools (and, on the Issues and issue chats' routes, their
// issue tools over a fixed issue table), records every tool call and usage record, serves
// lookups from a fixed project table (recording each, and answering
// ref_not_found for a listed missing `at`), and can be told to fail or hold the
// next usage hand-overs so the outbox's retry paths are testable.

import type { ProjectSnapshot, SkillsSnapshot, ToolsSocket, TurnRecord } from "./client.js";
import { ToolsSocketError } from "./client.js";

/**
 * The twelve design tools ae-studio-tools answers on `tools/list`, whatever
 * aep-api serves (aep-api `mcpdiscovery/mcp_tools.go`, pinned in
 * ae-studio-tools `internal/mcp`).
 */
export const DESIGN_TOOL_NAMES = [
  "list_external_resources",
  "get_external_resource_schema",
  "list_org_endpoints",
  "list_org_component_endpoints",
  "list_platform_resource_types",
  "list_groups",
  "list_guardrail_policies",
  "get_remote_git_file_contents",
  "search_remote_git_code",
  "validate_openapi_spec",
  "fetch_openapi_spec",
  "slice_openapi_spec",
] as const;

/** The Issues chat's tools (ae-studio-tools `mcp.IssuesTools`). */
export const ISSUES_TOOL_NAMES = ["search_issues", "create_issue"] as const;

/** An issue's chat tools (ae-studio-tools `mcp.IssueTools`). */
export const ISSUE_TOOL_NAMES = [
  "get_issue",
  "list_components",
  "comment_issue",
  "edit_issue",
  "close_issue",
  "reopen_issue",
  "hand_to_coding_agent",
] as const;

export interface FakeToolCall {
  name: string;
  arguments: unknown;
  /** The route the call came on: `/mcp`, or an Issues or issue chat's. */
  route?: string;
}

export interface FakeToolsSocketOptions {
  /** Known projects by name; any other name looks up as `null`. */
  projects?: Record<string, ProjectSnapshot>;
  /** `at` values that name no commit: `lookup` throws 404 `ref_not_found` for them, as the socket does. */
  missingRefs?: string[];
  /** The skills snapshot's sha (`skills()`). */
  skillsSha?: string;
  /** A tool's text result; defaults to `{"tool": <name>}` (an issue route's `get_issue` reads `issues`). */
  callTool?: (call: FakeToolCall) => string;
  /** Issues by number, as every project's issue routes answer them; any other number is not found. */
  issues?: Record<number, { state: "open" | "closed"; title?: string }>;
}

interface JsonRpcRequest {
  id?: unknown;
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** @knipkeep test seam: the in-process ToolsSocket the tests drive turns with */
export class FakeToolsSocket implements ToolsSocket {
  /** Every record `postUsage` accepted, in order. */
  readonly usage: TurnRecord[] = [];
  /** Every `tools/call`, in order. */
  readonly toolCalls: FakeToolCall[] = [];
  /** Every `lookup` call, in order; `at` only when given. */
  readonly lookups: Array<{ project: string; at?: string }> = [];
  /** Every `postUsage` call, accepted or not. */
  usageAttempts = 0;

  private readonly projects: Record<string, ProjectSnapshot>;
  private readonly missingRefs: ReadonlySet<string>;
  private readonly skillsSha: string;
  private readonly callTool: (call: FakeToolCall) => string;
  private readonly issues: Record<number, { state: "open" | "closed"; title?: string }>;
  private failures = 0;
  private failStatus = 503;
  private held: Promise<void> | null = null;
  private lookupHeld: Promise<void> | null = null;
  private lookupFault: ToolsSocketError | null = null;

  constructor(opts: FakeToolsSocketOptions = {}) {
    this.projects = opts.projects ?? {};
    this.missingRefs = new Set(opts.missingRefs ?? []);
    this.skillsSha = opts.skillsSha ?? "skills-fake";
    this.callTool = opts.callTool ?? ((call) => JSON.stringify({ tool: call.name }));
    this.issues = opts.issues ?? {};
  }

  /** The next `count` `postUsage` calls fail: 503 (transient), or 400 when `permanent`. */
  failUsage(count: number, opts: { permanent?: boolean } = {}): void {
    this.failures = count;
    this.failStatus = opts.permanent ? 400 : 503;
  }

  /** `postUsage` calls wait until `release()`; nothing is recorded meanwhile. */
  holdUsage(): { release(): void } {
    let release!: () => void;
    this.held = new Promise<void>((resolve) => (release = resolve));
    return {
      release: () => {
        this.held = null;
        release();
      },
    };
  }

  /**
   * The next `lookup` throws this 404 problem whatever `at` says: the socket
   * can answer `ref_not_found` for a lookup with no `at` when `git archive`
   * of the tip it just resolved fails (a race with a force-push).
   */
  failNextLookup(code: string): void {
    this.lookupFault = new ToolsSocketError(code, 404, "the studio could not read the project's tree");
  }

  /** Later `lookup`s of a known project answer this head (a commit landed: a Room save). */
  setHead(project: string, headSha: string): void {
    const known = this.projects[project];
    if (known) this.projects[project] = { ...known, headSha };
  }

  /** `lookup` calls wait until `release()` (a cold tools sidecar). */
  holdLookups(): { release(): void } {
    let release!: () => void;
    this.lookupHeld = new Promise<void>((resolve) => (release = resolve));
    return {
      release: () => {
        this.lookupHeld = null;
        release();
      },
    };
  }

  /** Close or reopen an issue of the table (as GitHub would, outside the pod). */
  setIssueState(number: number, state: "open" | "closed"): void {
    this.issues[number] = { ...this.issues[number], state };
  }

  readonly mcpFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as JsonRpcRequest;
    if (req.id === undefined) return new Response(null, { status: 202 });
    const route = new URL(String(input), "http://mcp.sock").pathname;
    const issueRoute = /^\/projects\/[^/]+\/issues(?:\/(\d+))?\/mcp$/.exec(route);
    if (issueRoute) return this.issueRoute(req, route, issueRoute[1] === undefined ? undefined : Number(issueRoute[1]));
    if (req.method === "initialize") {
      return json({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } } });
    }
    if (req.method === "tools/list") {
      const tools = DESIGN_TOOL_NAMES.map((name) => ({
        name,
        description: name,
        inputSchema: { type: "object", properties: {} },
      }));
      return json({ jsonrpc: "2.0", id: req.id, result: { tools } });
    }
    if (req.method === "tools/call") {
      const call = { name: String(req.params?.name), arguments: req.params?.arguments ?? {} };
      if (!(DESIGN_TOOL_NAMES as readonly string[]).includes(call.name)) {
        return json({ jsonrpc: "2.0", id: req.id, error: { code: -32602, message: `unknown tool: ${call.name}` } });
      }
      this.toolCalls.push(call);
      return json({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: this.callTool(call) }] } });
    }
    return json({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } });
  }) as typeof fetch;

  /** An Issues (no number) or issue chat's route: its tools only. */
  private issueRoute(req: JsonRpcRequest, route: string, number: number | undefined): Response {
    const names: readonly string[] = number === undefined ? ISSUES_TOOL_NAMES : ISSUE_TOOL_NAMES;
    if (req.method === "tools/list") {
      const tools = names.map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } }));
      return json({ jsonrpc: "2.0", id: req.id, result: { tools } });
    }
    if (req.method !== "tools/call") return json({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } });
    const call = { name: String(req.params?.name), arguments: req.params?.arguments ?? {}, route };
    if (!names.includes(call.name)) {
      return json({ jsonrpc: "2.0", id: req.id, error: { code: -32602, message: `tool not allowed: ${call.name}` } });
    }
    this.toolCalls.push(call);
    if (number !== undefined && call.name === "get_issue") {
      const issue = this.issues[number];
      if (!issue) {
        const text = "the issue was not found on the project's repository; nothing was done";
        return json({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text }], isError: true } });
      }
      const text = JSON.stringify({ number, title: issue.title ?? `Issue ${number}`, state: issue.state });
      return json({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text }] } });
    }
    return json({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: this.callTool(call) }] } });
  }

  async postUsage(r: TurnRecord): Promise<void> {
    this.usageAttempts++;
    if (this.held) await this.held;
    if (this.failures > 0) {
      this.failures--;
      throw new ToolsSocketError(this.failStatus === 400 ? "invalid_record" : "aep_api_unavailable", this.failStatus);
    }
    this.usage.push(r);
  }

  async lookup(project: string, at?: string): Promise<ProjectSnapshot | null> {
    this.lookups.push(at === undefined ? { project } : { project, at });
    if (this.lookupHeld) await this.lookupHeld;
    const fault = this.lookupFault;
    if (fault) {
      this.lookupFault = null;
      throw fault;
    }
    const known = this.projects[project];
    // The project resolves first, as on the socket: an unknown project is null whatever `at` says.
    if (known && at !== undefined && this.missingRefs.has(at)) {
      throw new ToolsSocketError("ref_not_found", 404, "at names no commit of the repository");
    }
    return known ? { ...known, references: [...known.references] } : null;
  }

  async skills(): Promise<SkillsSnapshot> {
    return { skillsSha: this.skillsSha };
  }
}
