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
 * Headless task-planner runners — the model-facing core, decoupled from SSE. The
 * route (route.ts) wraps these with the wire frames aep-api's task_stream
 * parses; the eval and playground call them directly.
 *
 * Phase 1 (plan) is a structured-output stream: `streamObject` in array mode
 * (Anthropic rejects a top-level "array" tool schema, so the element schema +
 * output:"array" is used) with the seal-rule — emit element i once i is no
 * longer the trailing element being typed — surfaced behind `onSealed`.
 *
 * Phase 2 (detail) is a prose stream per task (`streamText`); the runner streams
 * deltas behind `onDelta` and returns the full body.
 */

import { streamObject, streamText, type LanguageModel } from "ai";
import {
  PlanItemSchema,
  type TaskPlannerPlanInput,
  type TaskPlannerDetailItem,
  type ResolvedSkill,
  type PlanIssue,
} from "./schema.js";
import {
  planSystemPrompt,
  buildPlanUserPrompt,
  detailSystemPrompt,
  buildDetailUserPrompt,
} from "./prompt.js";
import {
  validatePlan,
  type DiffContext,
  type PlanItemWithTempId,
} from "./validator.js";

/** Thrown when a sealed plan element fails PlanItemSchema. Carries the wire
 * fields the route emits as a `malformed-plan-item` error frame. */
export class MalformedPlanItemError extends Error {
  constructor(
    public readonly index: number,
    public readonly issues: unknown,
  ) {
    super(`malformed plan item at index ${index}`);
    this.name = "MalformedPlanItemError";
  }
}

export interface TaskPlannerPlanRunResult {
  items: PlanItemWithTempId[];
  issues: PlanIssue[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface TaskPlannerPlanRunOpts {
  model: LanguageModel;
  input: TaskPlannerPlanInput;
  /** Pre-computed diff context for incremental coverage rules (BFF supplies). */
  diff?: DiffContext;
  /** Invoked as each plan element seals — route → SSE. Omit in evals. */
  onSealed?: (item: PlanItemWithTempId) => void;
  /** True once the client is gone; stops sealing early. */
  isClosed?: () => boolean;
  abortSignal?: AbortSignal;
}

export async function runTaskPlannerPlan(
  opts: TaskPlannerPlanRunOpts,
): Promise<TaskPlannerPlanRunResult> {
  const { model, input, diff, onSealed, isClosed, abortSignal } = opts;

  // Anthropic (via AI SDK) requires a tool input_schema of type "object". A
  // top-level array schema serializes to type "array" and is rejected, so use
  // the SDK's array mode: pass the element schema + output:"array". The stream
  // still yields the growing array + result.object is the full array, which is
  // exactly what the seal-rule below consumes.
  const result = streamObject({
    model,
    output: "array",
    system: planSystemPrompt,
    prompt: buildPlanUserPrompt(input),
    schema: PlanItemSchema,
    ...(abortSignal ? { abortSignal } : {}),
    onError: ({ error }) => {
      console.error("[task-planner/plan] streamObject error:", error);
    },
  });

  const sealed: PlanItemWithTempId[] = [];
  let sealedThrough = -1;

  const sealOne = (i: number, raw: unknown): void => {
    const parsedItem = PlanItemSchema.safeParse(raw);
    if (!parsedItem.success) {
      throw new MalformedPlanItemError(i, parsedItem.error.format());
    }
    const item: PlanItemWithTempId = { tempId: `p-${i}`, ...parsedItem.data };
    sealed.push(item);
    sealedThrough = i;
    onSealed?.(item);
  };

  // Seal-rule: emit element i when the partial array length ≥ i+2 (so element
  // i is no longer the trailing one still being typed).
  for await (const partial of result.partialObjectStream) {
    if (isClosed?.()) break;
    if (!Array.isArray(partial)) continue;
    const sealedTo = partial.length - 2;
    for (let i = sealedThrough + 1; i <= sealedTo; i++) sealOne(i, partial[i]);
  }

  // Stream ended — flush the trailing element(s).
  const final = await result.object;
  for (let i = sealedThrough + 1; i < final.length; i++) sealOne(i, final[i]);

  const issues = validatePlan({
    items: sealed,
    design: input.slimDesign,
    existingTasks: input.existingTasks ?? [],
    mode: input.mode,
    ...(diff ? { diff } : {}),
  });

  const u = await result.usage;
  return {
    items: sealed,
    issues,
    usage: {
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    },
  };
}

export interface TaskPlannerDetailRunResult {
  body: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface TaskPlannerDetailRunOpts {
  model: LanguageModel;
  projectName: string;
  spec: string;
  item: TaskPlannerDetailItem;
  /** The pushed `task-breakdown` skill (shapes issue-brief quality). Optional. */
  taskBreakdownSkill?: ResolvedSkill;
  /** Invoked per text chunk — route coalesces into task-body-delta frames. */
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
}

/**
 * Stream one task's GitHub issue body. Returns the full body; `onDelta` sees
 * each chunk as it streams (the route coalesces them into
 * `data-task-body-delta` frames, then emits `data-task-body-complete`).
 */
export async function runTaskPlannerDetailItem(
  opts: TaskPlannerDetailRunOpts,
): Promise<TaskPlannerDetailRunResult> {
  const { model, projectName, spec, item, taskBreakdownSkill, onDelta, abortSignal } = opts;

  const result = streamText({
    model,
    system: detailSystemPrompt,
    prompt: buildDetailUserPrompt(projectName, spec, item, taskBreakdownSkill),
    ...(abortSignal ? { abortSignal } : {}),
    onError: ({ error }) => {
      console.error(`[task-planner/detail ${item.taskId}] streamText error:`, error);
    },
  });

  let body = "";
  for await (const chunk of result.textStream) {
    body += chunk;
    onDelta?.(chunk);
  }

  const u = await result.usage;
  return {
    body,
    usage: {
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    },
  };
}
