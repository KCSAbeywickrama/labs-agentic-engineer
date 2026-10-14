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
 * The human-in-the-loop question tools (`ask_question`, `ask_questions`): the
 * main agent's `files` set and every area sub-agent (via the tool registry)
 * take the same two.
 */

import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import type { AskQuestionInput, AskQuestionsInput, Equal } from "@aep/agent-stream";

// --- ask_question / ask_questions (HITL, console ADR-0012 / #270) -------------
// Structured multiple-choice questions the agent asks when it needs a human
// decision. Each tool HAS an execute() returning a RESOLVED placeholder, so the
// turn ends fully-resolved (no dangling tool_use → no MissingToolResultsError on
// persist/replay). Registered on the `files` tool set (see buildFileToolSet) and
// paired with a stop condition at the call site (run-conversation-turn.ts)
// that ends the turn at an ACCEPTED call — one the schema rejected leaves an
// error result the model retries on instead; the user's answer
// arrives as the NEXT turn's plain user message (`buildAnswerInstruction` /
// `buildAnswersInstruction`). PROPERTY ORDER is load-bearing: `question` first so
// a consumer can render the card header the instant it resolves; the `options`
// list streams after.
//
// The description keeps the tool RESTRICTIVE ("only when you cannot proceed
// safely") for ordinary generation turns; the platform `grilling` skill loosens
// that during interviews. Always registered — no per-turn gating (#270 decision 6).

const askQuestionOptionSchema = z.object({
  label: z
    .string()
    .min(1, "An option needs a label — for a typed answer, omit the option: the form always offers a free-text field.")
    .describe("Short display text for this choice — the exact value echoed back in the answer. Keep labels unique within a question."),
  description: z.string().optional().describe(
    "The full explanation of this choice, shown on the option card. Write 2–4 sentences: what picking it " +
    "means concretely, what it implies or rules out, and its trade-offs versus the other options — enough " +
    "for a non-expert to decide confidently. Always provide it unless the label is truly self-explanatory.",
  ),
  recommended: z.boolean().optional().describe("Mark the ONE option you recommend (at most one per question)."),
  freeText: z.boolean().optional().describe(
    "Set true on an option whose selection requires the user to TYPE their answer (an 'Other' / 'Something else' " +
    "escape hatch): the form focuses the text field and blocks submit until text is entered. When the ENTIRE " +
    "question needs a typed answer, prefer an empty options array instead.",
  ),
  action: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("accept-assumption"),
        dependency: z.string().min(1).describe("The dependency's directory name (specs/design/dependencies/<name>)."),
      }),
      z.object({
        kind: z.literal("upload-interface"),
        dependency: z.string().min(1).describe("The dependency's directory name (specs/design/dependencies/<name>)."),
      }),
    ])
    .optional()
    .describe(
      "What choosing this option DOES, run by the console when the user submits, before the answer reaches you. " +
      "'accept-assumption': records the user's authorization to build on the interface you will write from research " +
      "— use it on the 'proceed on your assumption' option of the resolve-dependency flow, so no separate acceptance " +
      "is needed. 'upload-interface': opens the interface upload for the dependency; the answer arrives once the " +
      "document is on disk. Never on any other option.",
    ),
});

export const askQuestionInputSchema = z.object({
  question: z.string().describe("The clarifying question to ask the user — specific and self-contained, not a vague topic."),
  detail: z.string().optional().describe(
    "Context shown under the question: why you are asking, what part of the spec or design this decision " +
    "affects, and any background the user needs to answer well. 1–3 sentences; plain language.",
  ),
  options: z
    .array(askQuestionOptionSchema)
    .max(5)
    .refine((opts) => opts.filter((o) => o.recommended).length <= 1, {
      message: "At most one option may be marked recommended.",
    })
    .describe(
      "0–5 answer options the user picks from; labels are the selection identity. Pass an EMPTY array when " +
      "the answer must be typed (no sensible presets) — the form always offers a free-text field, so never " +
      "invent placeholder options like 'Type my own answer' or 'Other'.",
    ),
  multiSelect: z
    .boolean()
    .optional()
    .describe("True → the user may pick several options together (checkboxes). Defaults to false (a single choice)."),
});

export const askQuestionsInputSchema = z.object({
  questions: z
    .array(askQuestionInputSchema)
    .min(1)
    .max(8)
    .describe("1–8 questions rendered together as one form; each answered independently."),
});

// Drift guard: each schema's inferred input stays equal to its wire type.
const _drift: [
  Equal<z.infer<typeof askQuestionInputSchema>, AskQuestionInput>,
  Equal<z.infer<typeof askQuestionsInputSchema>, AskQuestionsInput>,
] = [true, true];
void _drift;

/** Ask ONE structured question (a single card); ends the turn (HITL). */
export const askQuestionTool: Tool = tool({
  description:
    "Ask the user ONE structured multiple-choice question when you cannot proceed safely without their decision. " +
    "Make it decidable without prior context: put the why/what-it-affects in `detail`, and explain every option's " +
    "meaning and trade-offs in its `description`. Give 0–5 options (0 = a typed answer is required; mark at most one recommended); set multiSelect " +
    "when several may apply together. Ends your turn; the user's answer arrives as the next message.",
  inputSchema: askQuestionInputSchema,
  execute: async (input) => ({ status: "awaiting_user_response" as const, ...input }),
});

/** Ask a LIST of structured questions answered as one form; ends the turn (HITL). */
export const askQuestionsTool: Tool = tool({
  description:
    "Ask the user SEVERAL structured questions at once, rendered as a single form — use it when you have multiple " +
    "independent decisions to gather in one round instead of asking them one turn at a time. Each entry is a full " +
    "question (1–5 options, optional recommended, optional multiSelect). Ends your turn; the answers arrive as the next message.",
  inputSchema: askQuestionsInputSchema,
  execute: async (input) => ({ status: "awaiting_user_response" as const, ...input }),
});
