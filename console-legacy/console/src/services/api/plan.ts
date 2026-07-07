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
 * The task-plan turn runner — the console's entry point to the BFF's plan
 * endpoint (`POST …/tasks/plan`).
 *
 * Unlike `runTurn` (which folds file-mutation tool calls into a `FileBundle`),
 * the plan turn sends NO files and the BFF — not the FE — performs the GitHub
 * writes as `planTask` / `updateTask` tool-result frames stream past it (§6 of
 * docs/design/tasks-github-native.md). The tap writes BEFORE forwarding, so an
 * ok result frame means the issue already exists/was patched — the caller
 * refreshes its task list on these frames and the row materializes in place
 * (no draft cards, §8).
 *
 * The wire is raw `StreamPart` frames parsed by the shared `@aep/agent-stream`
 * reader (no reimplemented SSE loop, no ad-hoc frame contract). The task-tool
 * input/result shapes come from the same package, so the console, the agents
 * service, and the Go plan tap speak one definition.
 */

import {
  parseSseStream,
  PLAN_TASK,
  UPDATE_TASK,
  type StreamPart,
  type PlanTaskInput,
  type PlanTaskResult,
  type UpdateTaskInput,
  type UpdateTaskResult,
} from '@aep/agent-stream';
import { API_V1, authHeaders, parseErrorEnvelope } from './http';

/** Pre-stream / in-band failure codes mapped from the BFF's HTTP statuses. */
export type PlanErrorCode =
  | 'no_approved_design' // 400 — no approved spec/design tag to plan against
  | 'plan_in_progress' // 409 {code:"plan_in_progress"} — a plan is already running
  | 'not_found' // 404 — unknown project
  | 'upstream' // 502 — upstream agents-service error
  | 'request_failed' // any other non-2xx
  | 'stream_error'; // an in-band `error` frame (status was already 200)

export interface PlanHandlers {
  /** Assistant reasoning text deltas (a subtle "thinking" line). */
  onText?: (delta: string) => void;
  /** A `planTask` tool-call passed the BFF (the issue is NOT created yet). */
  onPlanTask?: (toolCallId: string, input: PlanTaskInput) => void;
  /** The `planTask` result — `ok` ⇒ the issue ALREADY exists; refresh to show it. */
  onPlanTaskResult?: (toolCallId: string, result: PlanTaskResult) => void;
  /** An `updateTask` tool-call passed the BFF (the issue is NOT patched yet). */
  onUpdateTask?: (toolCallId: string, input: UpdateTaskInput) => void;
  /** The `updateTask` result — `ok` ⇒ the issue was ALREADY patched; refresh to show it. */
  onUpdateTaskResult?: (toolCallId: string, result: UpdateTaskResult) => void;
}

export interface PlanOk {
  ok: true;
}

export interface PlanFailure {
  ok: false;
  code: PlanErrorCode;
  message: string;
}

export type PlanResult = PlanOk | PlanFailure;

/** A human-readable message for a pre-stream / in-band plan failure. */
export function planErrorMessage(result: PlanFailure): string {
  switch (result.code) {
    case 'no_approved_design':
      return result.message ||
        'Approve (publish) a design version before planning tasks.';
    case 'plan_in_progress':
      return 'A plan is already running for this project. Please wait for it to finish.';
    case 'upstream':
      return 'The planning service is unavailable. Please try again shortly.';
    default:
      return result.message || 'The request failed. Please try again.';
  }
}

function classifyPreStreamError(status: number, code: string | undefined): PlanErrorCode {
  if (code === 'plan_in_progress') return 'plan_in_progress';
  switch (status) {
    case 400:
      return 'no_approved_design';
    case 404:
      return 'not_found';
    case 409:
      // 409 without the `plan_in_progress` code still means a plan is running.
      return 'plan_in_progress';
    case 502:
    case 503:
    case 504:
      return 'upstream';
    default:
      return 'request_failed';
  }
}

/**
 * Best human-readable text from an in-band `error` frame's payload — prefers a
 * `.message` field when the payload is an object, rather than dumping the whole
 * object as JSON into the user-facing banner.
 */
function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
    return JSON.stringify(err);
  }
  return 'The planner reported an error.';
}

/**
 * Run one plan turn end to end. Resolves when the stream completes (or a typed
 * pre-stream / in-band failure). The BFF drains the upstream to completion even
 * if the caller aborts, so a tab close never orphans half-created issues.
 */
export async function planTasks(
  projectName: string,
  handlers: PlanHandlers = {},
  signal?: AbortSignal,
): Promise<PlanResult> {
  const res = await fetch(
    `${API_V1}/projects/${encodeURIComponent(projectName)}/tasks/plan`,
    {
      method: 'POST',
      headers: await authHeaders({ Accept: 'text/event-stream' }),
      body: '{}',
      signal,
    },
  );

  if (!res.ok || !res.body) {
    const { code, message } = await parseErrorEnvelope(res);
    return {
      ok: false,
      code: classifyPreStreamError(res.status, code),
      message: message || `Plan failed (HTTP ${res.status}).`,
    };
  }

  let streamError: string | null = null;

  for await (const part of parseSseStream(res.body) as AsyncIterable<StreamPart>) {
    const id = part.toolCallId ?? part.id ?? '';
    switch (part.type) {
      case 'text-delta': {
        const text = part.text ?? part.delta ?? '';
        if (text) handlers.onText?.(text);
        break;
      }
      case 'tool-call': {
        if (part.toolName === PLAN_TASK) {
          handlers.onPlanTask?.(id, part.input as PlanTaskInput);
        } else if (part.toolName === UPDATE_TASK) {
          handlers.onUpdateTask?.(id, part.input as UpdateTaskInput);
        }
        break;
      }
      case 'tool-result': {
        if (part.toolName === PLAN_TASK) {
          handlers.onPlanTaskResult?.(id, part.output as PlanTaskResult);
        } else if (part.toolName === UPDATE_TASK) {
          handlers.onUpdateTaskResult?.(id, part.output as UpdateTaskResult);
        }
        break;
      }
      case 'error': {
        streamError = errorText(part.error);
        break;
      }
      default:
        // text/finish/finish-step/tool-input-* — no plan action.
        break;
    }
  }

  if (streamError) {
    return { ok: false, code: 'stream_error', message: streamError };
  }
  return { ok: true };
}
