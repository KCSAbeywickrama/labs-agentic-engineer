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
 * Every tool an area profile (`src/areas/profiles.ts`) may name, by name. A
 * BUILT-IN is made here, per turn, by its factory; an MCP tool is aep-api's,
 * listed on the chat's MCP route (its name is a contract: the sub-agent takes
 * it, and the gate wraps it, by that name). A tool that changes anything the
 * user can see is not read-only and states its confirmation: the question the
 * agent asks with `ask_question`, the option that goes ahead, the option that
 * does not, and how the change is shown in the go-ahead option's description
 * (`describeChange`). The gate (`./gate.ts`, on `../agents/confirmation.ts`)
 * and the sub-agent's prompt (`../areas/prompt.ts`) both read these, so the
 * strings the model is told and the strings the code accepts cannot drift.
 */

import { ASK_QUESTION_TOOL, ASK_QUESTIONS_TOOL } from "@aep/agent-stream";
import type { Tool } from "ai";
import { describeArgs, type ChangeLayout, type Confirmation } from "../agents/confirmation.js";
import { askQuestionTool, askQuestionsTool } from "../agents/main/tools/files.js";
import type { McpTransport } from "../shared/mcp-client.js";
import { buildClassifyReportTool, CLASSIFY_REPORT } from "./classify-report.js";

/** A write's go-ahead: its question, the option that goes ahead, the one that does not, and its change's layout. */
export interface ToolConfirmation extends Confirmation {
  /** The other option of the card: change nothing. */
  decline: string;
  /** How the change is shown in the go-ahead option's description. */
  change: ChangeLayout;
}

/** What a built-in tool is made from: the chat's MCP route, where aep-api answers (`undefined`: none). */
export interface BuiltInContext {
  route: McpTransport | undefined;
}

interface Entry {
  /** True when the tool changes nothing the user can see. */
  readOnly: boolean;
  /** The go-ahead a write waits for; every write has one (`profileProblems`). */
  confirm?: ToolConfirmation;
}

export type RegisteredTool =
  | (Entry & { source: "built-in"; build: (ctx: BuiltInContext) => Tool })
  | (Entry & { source: "mcp" });

/** The other option of every issue write: change nothing. */
const NOT_NOW = "Not now";

export const TOOLS: Readonly<Record<string, RegisteredTool>> = {
  [ASK_QUESTION_TOOL]: { source: "built-in", readOnly: true, build: () => askQuestionTool },
  [ASK_QUESTIONS_TOOL]: { source: "built-in", readOnly: true, build: () => askQuestionsTool },
  // aep-api answers it on the chat's route (with the platform's key; the pod holds none).
  [CLASSIFY_REPORT]: { source: "built-in", readOnly: true, build: ({ route }) => buildClassifyReportTool(route) },
  search_issues: { source: "mcp", readOnly: true },
  get_issue: { source: "mcp", readOnly: true },
  list_components: { source: "mcp", readOnly: true },
  create_issue: {
    source: "mcp",
    readOnly: false,
    // Everything create_issue sends to GitHub.
    confirm: {
      question: "File this issue?",
      option: "File it",
      decline: "Change it",
      change: [
        ["title", (title) => `Title: ${title}`],
        ["kind", (kind) => `Kind: ${kind}`],
        ["body", (body) => `Body:\n${body}`],
      ],
    },
  },
  comment_issue: {
    source: "mcp",
    readOnly: false,
    confirm: { question: "Post this comment?", option: "Post it", decline: NOT_NOW, change: [["body", (body) => body]] },
  },
  edit_issue: {
    source: "mcp",
    readOnly: false,
    confirm: {
      question: "Apply this edit?",
      option: "Apply it",
      decline: NOT_NOW,
      change: [
        ["title", (title) => `Title: ${title}`],
        ["body", (body) => `Body:\n${body}`],
      ],
    },
  },
  close_issue: {
    source: "mcp",
    readOnly: false,
    confirm: { question: "Close this issue?", option: "Close it", decline: NOT_NOW, change: [["reason", (reason) => reason]] },
  },
  // Reopening has no change to show.
  reopen_issue: {
    source: "mcp",
    readOnly: false,
    confirm: { question: "Reopen this issue?", option: "Reopen it", decline: NOT_NOW, change: [] },
  },
  hand_to_coding_agent: {
    source: "mcp",
    readOnly: false,
    confirm: {
      question: "Hand this to the coding agent?",
      option: "Hand it over",
      decline: NOT_NOW,
      change: [["component", (component) => `Component: ${component}`]],
    },
  },
};

/** The tool registered as `name`, or undefined. */
export function registeredTool(name: string): RegisteredTool | undefined {
  return Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
}

/**
 * The change a call of the write `name` with `input` makes, as its go-ahead
 * option's description must show it (`describeArgs` over its layout): e.g.
 * "Title: <title>\n\nKind: <kind>\n\nBody:\n<body>" for create_issue, nothing
 * to reopen. Throws for a tool without a confirmation.
 */
export function describeChange(name: string, input: unknown): string {
  const confirm = registeredTool(name)?.confirm;
  if (confirm === undefined) throw new Error(`${name} has no confirmation`);
  return describeArgs(input, confirm.change);
}
