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
 * The file-mutation tools the main agent calls (the `files` tool set), built over
 * a FileBundle. The skill loaders (`loadSkill`/`loadSkillReference`) are shared
 * across tool sets and live in `./skill-tools.ts`.
 *
 * PROPERTY ORDER IS LOAD-BEARING. `path` is the first property in every schema
 * so the provider streams it first and a consumer can render the file header the
 * instant it resolves; the large string (`content` / `newString`) is last so it
 * streams delta-by-delta. The execute() return value IS what the model reads to
 * decide its next step.
 *
 * The Zod `inputSchema`s are the runtime validators; the corresponding wire
 * `*Input` types live in `@aep/agent-stream` (the source of truth). A compile-time
 * drift guard below asserts `z.infer<schema>` stays equal to each wire type.
 */

import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import {
  FileBundle,
  writeWithRenderCheck,
  ASK_QUESTION_TOOL,
  ASK_QUESTIONS_TOOL,
  DECLARE_PLAN_TOOL,
  type AddFileInput,
  type DeclarePlanInput,
  type EditFileInput,
  type Equal,
  type OpResult,
  type PrototypeRenderCheck,
  type RemoveFileInput,
} from "@aep/agent-stream";
import { handOffTools } from "./hand-off.js";
import { askQuestionTool, askQuestionsTool } from "./questions.js";
import { buildSkillTools } from "./skill-tools.js";
import { WriteLedger, type WriteOp } from "./write-ledger.js";
import type { SkillSource } from "../skill-source.js";

export const ADD_FILE = "addFile" as const;
export const EDIT_FILE = "editFile" as const;
export const REMOVE_FILE = "removeFile" as const;

// The HITL question tools' NAMES are owned by the wire contract
// (@aep/agent-stream) so the producer (this service) and the renderers
// (console, playground) can never split on a rename. Re-exported so the call
// site's question stop condition reads one definition.
export { ASK_QUESTION_TOOL, ASK_QUESTIONS_TOOL, DECLARE_PLAN_TOOL } from "@aep/agent-stream";

// Re-export the shared skill-loader names so existing importers keep one entry point.
export { LOAD_SKILL, LOAD_SKILL_REFERENCE } from "./skill-tools.js";

// --- Input schemas (runtime validators; their types are the wire `*Input`) ---

export const addFileInputSchema = z.object({
  path: z
    .string()
    .describe('New bundle path, e.g. "specs/design/components/foo/openapi.yaml". Must not already exist.'),
  content: z.string().describe("The full initial file body."),
});

export const editFileInputSchema = z.object({
  path: z.string().describe("Existing bundle path to edit."),
  oldString: z
    .string()
    .min(1)
    .describe("Verbatim snippet to replace, including its exact leading whitespace. Must occur exactly once."),
  newString: z.string().describe("Replacement text (may be empty to delete the snippet)."),
});

export const removeFileInputSchema = z.object({
  path: z.string().describe("Existing bundle path to delete."),
});

// --- declare_plan (fire-and-forget UI, console ADR-0022 / #576) -------------
//
// The agent says which bundle paths it is ABOUT to write, so the console's spec
// rail can show a checklist and an honest count instead of only a log of what
// already happened. Unlike the question tools (`./questions.ts`) this does NOT end the turn:
// `execute` resolves immediately and the agent keeps working, so the call
// site's stop condition never names it.

export const declarePlanInputSchema = z.object({
  paths: z
    .array(z.string())
    .describe(
      "The bundle paths you are about to write, in the order you intend to write them — full repo-relative " +
      'paths ("specs/design/design.md"). Names are the console\'s to choose; send paths only.',
    ),
});

// --- Drift guard: Zod schema ⇄ sse-events wire type -------------------------
// Compile-time only. If a schema's inferred input diverges from its wire type,
// the corresponding `true` is no longer assignable and this fails to compile,
// forcing the schema and contract back in sync. No meaningful runtime effect.
const _drift: [
  Equal<z.infer<typeof addFileInputSchema>, AddFileInput>,
  Equal<z.infer<typeof editFileInputSchema>, EditFileInput>,
  Equal<z.infer<typeof removeFileInputSchema>, RemoveFileInput>,
  Equal<z.infer<typeof declarePlanInputSchema>, DeclarePlanInput>,
] = [true, true, true, true];
void _drift;

/**
 * Declare the artifacts this turn is about to write. Fire-and-forget: the
 * tool-call input IS the payload, `execute` only acknowledges, and the turn
 * continues (ADR-0022). Declaring again ADDS to the plan — the console takes
 * the union, so a restated path is ignored rather than duplicated.
 */
export const declarePlanTool: Tool = tool({
  description:
    "Declare the files you are about to write, BEFORE you write them, so the user can see the whole shape of " +
    "the work and how much is left instead of watching files appear one at a time. Call it as soon as you know " +
    "part of the plan, and call it AGAIN whenever the plan grows — declaring the cell first and the " +
    "per-component files once the component set exists is the expected pattern, not a mistake. Restating a path " +
    "already declared is harmless. Does NOT end your turn: declare, then get on with the writing.",
  inputSchema: declarePlanInputSchema,
  execute: async (input) => ({ status: "ok" as const, ...input }),
});

/**
 * The write ops the ledger applies, bound to one bundle: the tool's OWN
 * `inputSchema` is the validator, so a call validated at input-end is validated
 * exactly as the SDK would validate it — no second copy of the rules. With a
 * `render` check, a write that leaves a whole prototype pair is drawn first
 * (asynchronously; the ledger queues later writes behind it).
 */
function buildWriteOps(bundle: FileBundle, render?: PrototypeRenderCheck): Record<string, WriteOp> {
  /** Tie a schema to its op, so the validated shape IS the applied shape. */
  const writeOp = <T>(schema: z.ZodType<T>, apply: (input: T) => OpResult | Promise<OpResult>): WriteOp => ({
    validate: (args) => {
      const parsed = schema.safeParse(args);
      return parsed.success ? parsed.data : undefined;
    },
    apply: (input) => apply(input as T),
  });
  return {
    [ADD_FILE]: writeOp(addFileInputSchema, ({ path, content }) =>
      render ? writeWithRenderCheck(bundle, { op: "add", path, content }, render) : bundle.addFile(path, content),
    ),
    [EDIT_FILE]: writeOp(editFileInputSchema, ({ path, oldString, newString }) =>
      render
        ? writeWithRenderCheck(bundle, { op: "edit", path, oldString, newString }, render)
        : bundle.editFile(path, oldString, newString),
    ),
    [REMOVE_FILE]: writeOp(removeFileInputSchema, ({ path }) => bundle.removeFile(path)),
  };
}

/**
 * The `files` tool set plus the turn's write ledger, as ONE object: every file
 * write goes through the ledger, so a caller that also taps the stream
 * (`tapWrites`) settles each write at its own `tool-input-end` instead of at the
 * step's tail, and neither half can drift from the other. A caller with no
 * stream to tap simply never pre-applies — the ledger's memo stays empty and
 * `execute()` applies exactly as it always did.
 */
export function buildFileToolSet(
  bundle: FileBundle,
  skills?: SkillSource,
  gates: { prototypeRender?: PrototypeRenderCheck } = {},
): { tools: Record<string, Tool>; writes: WriteLedger } {
  const writes = new WriteLedger(buildWriteOps(bundle, gates.prototypeRender));
  const tools: Record<string, Tool> = {
    [ADD_FILE]: tool({
      description:
        "Create a NEW file. The only tool that emits a whole body — use it for files that do not exist yet, " +
        "or (after removeFile) to replace a file wholesale. Errors with ALREADY_EXISTS if the path is already present.",
      inputSchema: addFileInputSchema,
      execute: async (input, { toolCallId }) => writes.apply(toolCallId, ADD_FILE, input),
    }),

    [EDIT_FILE]: tool({
      description:
        "Change part of an existing file by replacing oldString with newString. oldString must be copied VERBATIM " +
        "from the file (including leading indentation and newlines) and must match EXACTLY ONE location. On NOT_UNIQUE, " +
        "broaden the anchor with surrounding lines; on NOT_FOUND, re-copy the snippet exactly. Use this for prose AND " +
        "openapi.yaml.",
      inputSchema: editFileInputSchema,
      execute: async (input, { toolCallId }) => writes.apply(toolCallId, EDIT_FILE, input),
    }),

    [REMOVE_FILE]: tool({
      description:
        "Delete a file. Idempotent (deleting an absent path is a NOOP success). Refuses to delete the structural roots " +
        "(prd.md, design.cell) with PROTECTED_PATH.",
      inputSchema: removeFileInputSchema,
      execute: async (input, { toolCallId }) => writes.apply(toolCallId, REMOVE_FILE, input),
    }),

    // Human-in-the-loop questions (console ADR-0012 / #270). Registered on the
    // `files` set only; the call site's stop condition ends the turn at an
    // accepted call so it waits for the user's answer.
    [ASK_QUESTION_TOOL]: askQuestionTool,
    [ASK_QUESTIONS_TOOL]: askQuestionsTool,

    // A message that belongs in an area's chat goes to its agent (hand-off.ts):
    // the call ends the turn awaiting the user, like the question tools.
    ...handOffTools(),

    // Fire-and-forget UI (#576): deliberately NOT paired with a stop condition
    // at the call site — the agent declares and keeps working.
    [DECLARE_PLAN_TOOL]: declarePlanTool,
  };

  return { tools: { ...tools, ...buildSkillTools(skills) }, writes };
}

export const DRAFT_EXTERNAL_RESOURCE_TOOL = "draftExternalResource" as const;

const draftExternalResourceInputSchema = z.object({
  name: z.string().optional().describe("Resource identity (logical name)."),
  description: z.string().optional().describe("What the resource is."),
  consumptionInstructions: z
    .string()
    .optional()
    .describe("How a consuming project should use it — not a restatement of description."),
  provider: z.string().optional().describe("The concrete system the resource is (\"Open Exchange Rates\", \"Stripe\")."),
  contract: z
    .object({
      type: z.enum(["openapi", "graphql", "sdk", "asyncapi", "protobuf", "documentation"]),
      url: z.string().describe("The provider's published document. The platform fetches and copies it; never a file body."),
    })
    .optional()
    .describe("The resource's contract document, by URL. The platform fetches it into the organization's registry."),
  config: z
    .array(
      z.object({
        key: z.string().describe("Config key identity."),
        description: z.string().describe("What this key is for."),
        secret: z.boolean().describe("True when the value must never appear in chat."),
      }),
    )
    .optional()
    .describe("Config keys. Never include env values or secret bytes."),
  resourceDocs: z
    .array(
      z.object({
        type: z.enum(["documentation", "openapi", "graphql", "asyncapi", "protobuf"]),
        url: z.string().describe("Remote docs URL. Never a file body."),
      }),
    )
    .optional()
    .describe("Optional URL-only resource-docs. Never env values."),
});

/**
 * Console-folded draft for Marketplace register. Execute is a no-op: the
 * tool-call input IS the draft. Only registered on `/register-external-resource`
 * turns — never on spec/project files turns.
 */
export function buildRegisterDraftTools(): Record<string, Tool> {
  return {
    [DRAFT_EXTERNAL_RESOURCE_TOOL]: tool({
      description:
        "Draft the Registered External resource form (name, description, provider, consumption instructions, " +
        "config keys, the contract document's URL, optional URL resource-docs). Never include environment values or secret bytes. " +
        "Call this when you know enough to fill the form; ask_question first when you do not.",
      inputSchema: draftExternalResourceInputSchema,
      execute: async (input) => ({ status: "ok" as const, ...input }),
    }),
  };
}
