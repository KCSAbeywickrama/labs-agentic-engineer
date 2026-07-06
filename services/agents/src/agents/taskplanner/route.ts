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
 * The task-planner SSE routes — the wire surface aep-api's task_stream speaks.
 * Kept byte-identical to agents-legacy's contract so the cutover is a URL swap:
 *
 *   POST /internal/v1/agents/task-planner/plan    → data-plan-item* + data-plan-complete
 *   POST /internal/v1/agents/task-planner/detail  → data-task-body-delta* + data-task-body-complete
 *
 * Both stream `data: <frame>\n\n` frames and terminate with `data: [DONE]\n\n`,
 * under a `text/event-stream` response tagged `x-vercel-ai-ui-message-stream:
 * v1` (matching legacy). Pre-stream body validation is a plain HTTP 400.
 *
 * AUTH POSTURE (note for the cutover checklist): this service does NOT
 * re-authenticate — the conversation route documents the same stance ("behind
 * the platform BFF, which authenticates; this service does not
 * re-authenticate"). agents-legacy gated these routes with requireOrgId +
 * requireAnthropicKey middleware; this service has no JWT verification yet, so
 * per the migration plan we match the current posture rather than invent auth.
 * The per-org Anthropic key still travels on `X-Anthropic-Key` (aep-api's
 * client always sends it); when present the route builds a per-request model
 * from it, otherwise it falls back to the injected composition-root model
 * (dev / eval / playground / tests).
 */

import type { Express, Response } from "express";
import type { LanguageModel } from "ai";
import { createModel } from "../../shared/model.js";
import {
  PlanRequestBody,
  TaskPlannerDetailInput,
} from "./schema.js";
import {
  runTaskPlannerPlan,
  runTaskPlannerDetailItem,
  MalformedPlanItemError,
} from "./run.js";

/** Base path root — kept in sync with aep-api's `agentsBase` (client.go). */
export const TASK_PLANNER_BASE = "/internal/v1/agents/task-planner";

/** Header carrying the per-org effective Anthropic key (aep-api resolves it). */
const ANTHROPIC_KEY_HEADER = "x-anthropic-key";

/** Bounded concurrency for the phase-2 detail fan-out. */
const DETAIL_CONCURRENCY = Number.parseInt(
  process.env.TASK_PLANNER_PHASE2_CONCURRENCY || "4",
  10,
);
/** Coalesce window for task-body deltas (keeps frame volume sane). */
const DELTA_COALESCE_MS = 250;

export interface TaskPlannerDeps {
  /** Fallback model when no `X-Anthropic-Key` header is present (composition root). */
  model: LanguageModel;
}

function writeFrame(res: Response, frame: unknown): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(frame)}\n\n`);
}

function setupSse(res: Response): {
  abortController: AbortController;
  keepAlive: NodeJS.Timeout;
} {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "x-vercel-ai-ui-message-stream": "v1",
  });
  res.flushHeaders?.();

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(": keep-alive\n\n");
  }, 15_000);

  return { abortController, keepAlive };
}

/** Per-request model: prefer the forwarded per-org key, else the injected one. */
function resolveModel(res: Response, deps: TaskPlannerDeps): LanguageModel {
  const key = res.req.header(ANTHROPIC_KEY_HEADER);
  return key && key.length > 0 ? createModel({ apiKey: key }) : deps.model;
}

function isAbort(abortController: AbortController, err: unknown): boolean {
  return (
    abortController.signal.aborted &&
    (err instanceof Error
      ? err.name === "AbortError" || /aborted/i.test(err.message)
      : false)
  );
}

export function registerTaskPlanner(app: Express, deps: TaskPlannerDeps): void {
  registerPlan(app, deps);
  registerDetail(app, deps);
}

// =============================================================================
// Phase 1 — Plan
// =============================================================================

function registerPlan(app: Express, deps: TaskPlannerDeps): void {
  app.post(`${TASK_PLANNER_BASE}/plan`, async (req, res) => {
    const parsed = PlanRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const model = resolveModel(res, deps);
    const { abortController, keepAlive } = setupSse(res);

    try {
      const { items, issues } = await runTaskPlannerPlan({
        model,
        input: parsed.data,
        ...(parsed.data.diff ? { diff: parsed.data.diff } : {}),
        onSealed: (item) =>
          writeFrame(res, { type: "data-plan-item", data: item }),
        isClosed: () => res.writableEnded,
        abortSignal: abortController.signal,
      });

      if (issues.length > 0) {
        writeFrame(res, { type: "error", data: { scope: "plan", issues } });
        return;
      }

      writeFrame(res, { type: "data-plan-complete", data: { items } });
    } catch (err) {
      if (err instanceof MalformedPlanItemError) {
        writeFrame(res, {
          type: "error",
          data: {
            scope: "plan",
            code: "malformed-plan-item",
            index: err.index,
            issues: err.issues,
          },
        });
      } else if (!isAbort(abortController, err)) {
        console.error("[task-planner/plan] error:", err);
        writeFrame(res, {
          type: "error",
          data: {
            scope: "plan",
            errorText: err instanceof Error ? err.message : String(err),
          },
        });
      }
    } finally {
      clearInterval(keepAlive);
      if (!res.writableEnded) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }
  });
}

// =============================================================================
// Phase 2 — Detail (bounded streamText fan-out)
// =============================================================================

function registerDetail(app: Express, deps: TaskPlannerDeps): void {
  app.post(`${TASK_PLANNER_BASE}/detail`, async (req, res) => {
    const parsed = TaskPlannerDetailInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const model = resolveModel(res, deps);
    const { abortController, keepAlive } = setupSse(res);
    const data = parsed.data;

    try {
      // Tiny semaphore — keeps a bounded number of streamText calls in flight
      // without pulling in p-limit as a dep.
      const queue = [...data.items];

      const runNext = async (): Promise<void> => {
        const item = queue.shift();
        if (!item) return;
        await runDetailForItem(res, data.projectName, data.spec, item, abortController, model, data.taskBreakdownSkill);
        await runNext();
      };

      const initial = Math.min(DETAIL_CONCURRENCY, queue.length);
      await Promise.all(Array.from({ length: initial }, () => runNext()));
    } catch (err) {
      if (!isAbort(abortController, err)) {
        console.error("[task-planner/detail] fan-out error:", err);
        writeFrame(res, {
          type: "error",
          data: {
            scope: "detail",
            errorText: err instanceof Error ? err.message : String(err),
          },
        });
      }
    } finally {
      clearInterval(keepAlive);
      if (!res.writableEnded) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }
  });
}

async function runDetailForItem(
  res: Response,
  projectName: string,
  spec: string,
  item: TaskPlannerDetailInput["items"][number],
  abortController: AbortController,
  model: LanguageModel,
  taskBreakdownSkill: TaskPlannerDetailInput["taskBreakdownSkill"],
): Promise<void> {
  if (res.writableEnded) return;

  let pendingDelta = "";
  let lastFlush = Date.now();

  const flush = (): void => {
    if (pendingDelta.length === 0) return;
    writeFrame(res, {
      type: "data-task-body-delta",
      data: { taskId: item.taskId, delta: pendingDelta },
    });
    pendingDelta = "";
    lastFlush = Date.now();
  };

  try {
    const { body } = await runTaskPlannerDetailItem({
      model,
      projectName,
      spec,
      item,
      ...(taskBreakdownSkill ? { taskBreakdownSkill } : {}),
      abortSignal: abortController.signal,
      onDelta: (chunk) => {
        if (res.writableEnded) return;
        pendingDelta += chunk;
        if (Date.now() - lastFlush >= DELTA_COALESCE_MS) flush();
      },
    });
    flush();

    if (!res.writableEnded) {
      writeFrame(res, {
        type: "data-task-body-complete",
        data: { taskId: item.taskId, body },
      });
    }
  } catch (err) {
    if (isAbort(abortController, err)) return;
    console.error(`[task-planner/detail ${item.taskId}] error:`, err);
    writeFrame(res, {
      type: "error",
      data: {
        scope: "detail",
        taskId: item.taskId,
        errorText: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
