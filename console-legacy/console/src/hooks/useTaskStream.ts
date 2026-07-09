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

// useTaskStream — ONE SSE connection carrying a Task's whole live state (status
// + executions + unified timeline), replacing the three pollers the task detail
// page used to run (task re-poll + per-execution cursor poll + selection). It
// reduces the stream's `task`/`execution`/`line`/`done` frames into
// `{ task, executions, lines }`; history browsing is a client-side group-by over
// `lines` (by executionId), never a server round-trip.
//
// Wire parsing reuses the shared `parseSseStream` (the same `data:`/`[DONE]`
// frame reader behind the agents turn stream); this hook owns the fetch (auth
// header + SSE Accept), the reducer, and reconnect: a dropped connection re-opens
// and the server re-emits current state, which the reducer absorbs idempotently
// (task/execution upsert by id, lines dedup by executionId+seq+ts).

import { useEffect, useState } from 'react';
import { parseSseStream, type SseStreamEnd } from '@aep/agent-stream';
import { API_V1, authHeaders, parseErrorEnvelope } from '../services/api/http';
import type {
  ExecutionView,
  TaskStreamFrame,
  TaskView,
  TimelineEvent,
} from '../services/api';

export interface TaskStreamState {
  /** The Task header (null until the first `task` frame — the loading gate). */
  task: TaskView | null;
  /** Every attempt, oldest first (the timeline grouping order). */
  executions: ExecutionView[];
  /** The unified timeline across attempts, in arrival order, deduped. */
  lines: TimelineEvent[];
  /** True while a connection is open. */
  connected: boolean;
  /** The Task settled (deployed/abandoned) — the server sent `done` and closed. */
  settled: boolean;
  /** A hard failure (404 / auth) — transient reconnects do not set this. */
  error: string | null;
}

const INITIAL: TaskStreamState = {
  task: null,
  executions: [],
  lines: [],
  connected: false,
  settled: false,
  error: null,
};

const MAX_RECONNECT_DELAY_MS = 5000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function useTaskStream(
  projectId: string | undefined,
  issueNumber: number | undefined,
): TaskStreamState {
  const [state, setState] = useState<TaskStreamState>(INITIAL);

  useEffect(() => {
    if (!projectId || !Number.isFinite(issueNumber)) return undefined;
    setState(INITIAL);

    const controller = new AbortController();
    let cancelled = false;

    // Mutable accumulators; published to React state on a rAF throttle so a
    // burst of line frames (e.g. 200 lines on connect) coalesces into one paint.
    let task: TaskView | null = null;
    const execMap = new Map<string, ExecutionView>();
    const lines: TimelineEvent[] = [];
    const seen = new Set<string>();
    let settled = false;
    let raf = 0;

    const publish = () => {
      raf = 0;
      const executions = [...execMap.values()].sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
      );
      setState({ task, executions, lines: [...lines], connected: true, settled, error: null });
    };
    const schedulePublish = () => {
      if (raf === 0) raf = requestAnimationFrame(publish);
    };

    const applyFrame = (f: TaskStreamFrame) => {
      switch (f.type) {
        case 'task':
          // The contract types attention/dependsOn as nullable arrays; coerce
          // to [] so a clean task (attention === null on the wire) doesn't crash
          // the `.map` in the view — the same normalization the REST path does.
          task = {
            ...f.task,
            attention: f.task.attention ?? [],
            dependsOn: f.task.dependsOn ?? [],
          };
          break;
        case 'execution':
          execMap.set(f.execution.id, f.execution);
          break;
        case 'line': {
          const l = f.line;
          // Reconnect dedup: the server re-emits state on reconnect, so key each
          // line by its attempt + source seq + ts + kind + a content fragment
          // (the last guards the rare same-nanosecond, same-seq collision).
          const key = `${l.executionId}:${l.seq}:${l.ts}:${l.kind}:${l.summary ?? l.message ?? l.step ?? ''}`;
          if (!seen.has(key)) {
            seen.add(key);
            lines.push(l);
          }
          break;
        }
        case 'done':
          settled = true;
          break;
      }
      schedulePublish();
    };

    void (async () => {
      const url = `${API_V1}/projects/${encodeURIComponent(projectId)}/tasks/${issueNumber}/log`;
      let attempt = 0;
      while (!cancelled && !settled) {
        let end: SseStreamEnd | 'error' = 'eof';
        try {
          const res = await fetch(url, {
            cache: 'no-store',
            headers: await authHeaders({ Accept: 'text/event-stream' }),
            signal: controller.signal,
          });
          if (res.status === 404) {
            res.body?.cancel().catch(() => {});
            if (!cancelled) setState((s) => ({ ...s, connected: false, error: 'Task not found.' }));
            return;
          }
          if (!res.ok || !res.body) {
            const { message } = await parseErrorEnvelope(res);
            throw new Error(message || `Stream failed (HTTP ${res.status}).`);
          }
          attempt = 0; // a good connection resets backoff
          const it = parseSseStream(res.body)[Symbol.asyncIterator]();
          while (true) {
            const r = await it.next();
            if (r.done) {
              end = r.value;
              break;
            }
            applyFrame(r.value as unknown as TaskStreamFrame);
          }
        } catch (e) {
          if (cancelled || controller.signal.aborted) return;
          end = 'error';
        }
        if (cancelled || settled || end === 'done') break;
        // The connection dropped mid-stream — reconnect (linear backoff, capped).
        // The server re-emits current state, which the reducer absorbs idempotently.
        attempt += 1;
        try {
          await sleep(Math.min(500 * attempt, MAX_RECONNECT_DELAY_MS), controller.signal);
        } catch {
          return; // aborted during backoff
        }
      }
      if (!cancelled) {
        if (raf !== 0) cancelAnimationFrame(raf);
        // Final publish so the terminal state (settled / closed) always lands.
        const executions = [...execMap.values()].sort((a, b) =>
          a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
        );
        setState({ task, executions, lines: [...lines], connected: false, settled, error: null });
      }
    })();

    return () => {
      cancelled = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      controller.abort();
    };
  }, [projectId, issueNumber]);

  return state;
}
