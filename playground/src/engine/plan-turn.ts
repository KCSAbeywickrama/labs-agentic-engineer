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
 * A Plan turn (docs/design/playground.md §5 phase 3), started as aep-api
 * starts one in production: on the design agent's Turn socket, kind `plan`,
 * with the version's scope. The socket answers NDJSON — a `task-op` line per
 * ok `planBuild` result, keep-alives, then one `result` line — and the
 * playground writes the build issue from the last one only when the result is
 * `completed`. The turn's full stream is read beside it on `/v1` for live
 * rendering.
 */

import { randomUUID } from "node:crypto";
import { request, type IncomingMessage } from "node:http";
import { createInterface } from "node:readline";
import { parseSseStream, type BuildPlanOk, type PlanScope, type StreamPart } from "@aep/agent-stream";
import type { ResultFrame, TaskOpFrame, TurnSocketFrame } from "@aep/ae-design-agent/edge/turn-socket";
import { PLAYGROUND_USER } from "../kit/auth.js";
import type { TurnSession } from "./turn.js";

/** One task operation, as the Turn socket's `task-op` line carries it. */
export type TaskOp = Pick<TaskOpFrame, "op" | "output">;

/** What a Plan turn produced: the operations to fold, and whether they may be. */
export interface PlanTurnOutcome {
  /** The result line said `completed`: the operations are final. */
  completed: boolean;
  taskOps: TaskOp[];
}

export interface PlanTurnResult extends PlanTurnOutcome {
  /** The turn's stream parts, for rendering and traces. */
  parts: StreamPart[];
  error?: string;
}

export interface PlanTurnOptions {
  onPart?: (part: StreamPart) => void;
  /** What the version carries, as aep-api computes it (features, product-wide items, held-back stories). */
  scope?: PlanScope;
}

/** The checklist a completed Plan turn settled on: its last ok `planBuild`, as aep-api's plan tap keeps it. */
export function lastBuildPlan(turn: PlanTurnOutcome): BuildPlanOk | undefined {
  if (!turn.completed) return undefined;
  for (let i = turn.taskOps.length - 1; i >= 0; i--) {
    const { op, output } = turn.taskOps[i]!;
    const out = output as Partial<BuildPlanOk> | undefined;
    if (op === "build" && out?.ok === true && out.op === "build" && Array.isArray(out.items) && out.items.length > 0) return out as BuildPlanOk;
  }
  return undefined;
}

/** POST one request to the Turn socket; resolves once the response headers arrive. */
function postTurnSocket(socketPath: string, body: unknown): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: "/turns", method: "POST", headers: { "content-type": "application/json" } }, resolve);
    req.once("error", reject);
    req.end(JSON.stringify(body));
  });
}

/** Read the `/v1` stream of `turnId` from frame 0, rendering each part. */
async function streamParts(session: TurnSession, turnId: string, parts: StreamPart[], onPart?: (part: StreamPart) => void): Promise<void> {
  const url = `${session.baseUrl}/v1/projects/${encodeURIComponent(session.project)}/turns/${encodeURIComponent(turnId)}/stream?from=0`;
  const res = await fetch(url, { headers: session.headers });
  if (!res.ok || !res.body) throw new Error(`plan stream: HTTP ${res.status}`);
  for await (const part of parseSseStream(res.body)) {
    parts.push(part);
    onPart?.(part);
  }
}

/** Run one Plan turn. */
export async function runPlanTurn(session: TurnSession, opts: PlanTurnOptions = {}): Promise<PlanTurnResult> {
  const turnId = randomUUID();
  const parts: StreamPart[] = [];
  const taskOps: TaskOp[] = [];
  const res = await postTurnSocket(session.turnSocket, {
    turnId,
    project: session.project,
    kind: "plan",
    credit: { userId: PLAYGROUND_USER.sub, name: PLAYGROUND_USER.name, email: PLAYGROUND_USER.email },
    ...(opts.scope ? { scope: opts.scope } : {}),
  });
  if (res.statusCode !== 200) {
    let text = "";
    for await (const chunk of res) text += String(chunk);
    return { completed: false, taskOps, parts, error: `plan turn refused: HTTP ${res.statusCode} ${text}` };
  }
  // The turn is started: its `/v1` stream is readable beside the socket's.
  // Settled at once, so a socket read that throws leaves no rejection behind.
  const rendering = streamParts(session, turnId, parts, opts.onPart).then(
    () => undefined,
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  );
  let result: ResultFrame | undefined;
  for await (const line of createInterface({ input: res, crlfDelay: Infinity })) {
    if (line.trim() === "") continue;
    const frame = JSON.parse(line) as TurnSocketFrame;
    if (frame.type === "task-op") taskOps.push({ op: frame.op, output: frame.output });
    if (frame.type === "result") result = frame;
  }
  const renderError = await rendering;
  const completed = result?.status === "completed";
  const error = !result
    ? "the Turn socket closed without a result"
    : !completed
      ? (result.message ?? result.code ?? "plan turn failed")
      : renderError;
  return { completed, taskOps, parts, ...(error ? { error } : {}) };
}
