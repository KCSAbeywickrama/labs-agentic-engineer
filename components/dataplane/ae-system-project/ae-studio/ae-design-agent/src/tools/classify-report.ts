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
 * The Issues chat's `classify_report` tool: what kind of report the user's
 * message is. aep-api answers it on the Issues chat's MCP route (its
 * `classify_report`, which asks Jev with the platform's key: the pod never
 * holds one); this tool decides whether the agent must ask. The agent files on
 * a confident bug / feature / improvement and asks otherwise.
 *
 * Every failure — no route, the socket or aep-api not answering, a tool error,
 * a malformed answer, aep-api's own `unknown` (no key, Jev down, the org past
 * its rate) — resolves to `unknown` with `needsClarification`, so a
 * classifier outage degrades to the agent asking and never fails a turn.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { callMcpTool, type McpTransport } from "../shared/mcp-client.js";

export const CLASSIFY_REPORT = "classify_report";

export type ReportKind = "bug" | "feature" | "improvement" | "question";

export interface ClassifyReportResult {
  kind: ReportKind | "unknown";
  confidence: number;
  /** The two most probable kinds, most probable first. */
  alternatives: { kind: ReportKind; p: number }[];
  /** True when the agent must ask before filing. */
  needsClarification: boolean;
}

/** Filing needs at least this much confidence; a `question` never files. */
const CLARIFY_BELOW = 0.8;

const KINDS = ["bug", "feature", "improvement", "question"] as const;

/** aep-api's `classify_report` answer. */
const answerSchema = z.object({
  kind: z.enum([...KINDS, "unknown"]),
  confidence: z.number(),
  alternatives: z.array(z.object({ kind: z.enum(KINDS), p: z.number() })).optional(),
});

const UNKNOWN: ClassifyReportResult = { kind: "unknown", confidence: 0, alternatives: [], needsClarification: true };

function unknown(reason: string): ClassifyReportResult {
  console.warn(`classify_report: ${reason}`);
  return { ...UNKNOWN, alternatives: [] };
}

/** Classify through `route` (the Issues chat's MCP route); `undefined` (no route) is unknown. */
export async function classifyReport(
  route: McpTransport | undefined,
  input: { message: string; recentMessages?: string[] },
): Promise<ClassifyReportResult> {
  if (!route) return unknown("no Issues route");
  let res: { text: string; isError: boolean };
  try {
    res = await callMcpTool(route, CLASSIFY_REPORT, {
      message: input.message,
      ...(input.recentMessages ? { recentMessages: input.recentMessages } : {}),
    });
  } catch (err) {
    return unknown(err instanceof Error ? err.name : "the tools socket did not answer");
  }
  if (res.isError) return unknown("the classifier refused the call");
  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    return unknown("answer is not JSON");
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) return unknown("malformed answer");
  const { kind, confidence, alternatives } = parsed.data;
  if (kind === "unknown") return { ...UNKNOWN, alternatives: [] };
  return {
    kind,
    confidence,
    alternatives: alternatives?.length ? alternatives.slice(0, 2) : [{ kind, p: confidence }],
    needsClarification: kind === "question" || confidence < CLARIFY_BELOW,
  };
}

const classifyReportInputSchema = z.object({
  message: z.string().min(1).describe("The user's message to classify, verbatim."),
  recentMessages: z
    .array(z.string())
    .max(6)
    .optional()
    .describe("Up to six of the latest earlier messages, oldest first, to resolve words like it or that."),
});

/** The `classify_report` tool over `route`: what kind of report the user's message is. */
export function buildClassifyReportTool(
  route: McpTransport | undefined,
): Tool<z.infer<typeof classifyReportInputSchema>, ClassifyReportResult> {
  return tool({
    description:
      "Classify a user's message as a bug, feature, improvement or question, with a confidence. " +
      "Call it before filing an issue. A question is answered, not filed (do not ask which kind). Otherwise, when " +
      "needsClarification is true (this includes kind unknown, when the classifier is unavailable), ask the user " +
      "which kind it is instead of filing.",
    inputSchema: classifyReportInputSchema,
    execute: ({ message, recentMessages }) => classifyReport(route, { message, ...(recentMessages ? { recentMessages } : {}) }),
  });
}
