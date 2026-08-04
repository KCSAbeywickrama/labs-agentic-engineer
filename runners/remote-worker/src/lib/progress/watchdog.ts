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

// Tells a slow run apart from a wedged one.
//
// A coding run's only sign of life is its progress feed, and a genuinely long
// step is indistinguishable from a hang while that feed is silent — one real
// run went 8m49s between lines inside a `bal tool pull`, and nothing said
// whether it was working or dead. The watchdog periodically reports what the
// run is WAITING ON, which is the diagnosis rather than the symptom:
//
//   - a tool is in flight  → the tool is slow or stuck, and the line names it
//   - nothing is in flight → the model turn is slow or stuck
//
// Those are different faults with different fixes, and the feed could not
// previously distinguish them at all.
//
// "The model turn is stuck" was the end of the diagnosis and is now the middle
// of it: `observeRetry` and `observeStream` carry the two things that tell those
// stalls apart — an API retry storm, or a generation that is simply long. Both
// are recorded WITHOUT counting as activity, and that is the point. A retry is
// the absence of progress, so letting one reset the idle clock would have kept
// the watchdog quiet through exactly the stall it exists to report: the measured
// backoff climbs through 0.2s → 33.6s, all of it inside the idle window.
//
// It reports at `warn`, never `error`, and never terminates the run: a long
// dependency pull is legitimate, and a watchdog that failed the run on its own
// clock would be a worse bug than the silence it replaces.

import type { ProgressEventInput } from "./schema.js";
import { emit as defaultEmit } from "./emitter.js";
import type { ApiRetryInfo } from "./diagnostics.js";

// Long enough that an ordinary compile or install does not trip it, short
// enough that a multi-minute dead zone turns into several informative lines
// instead of one silent terminal.
export const DEFAULT_IDLE_MS = 120_000;

interface InFlight {
  tool: string;
  summary: string;
  startedAt: number;
}

export interface RunWatchdogOptions {
  /** Silence tolerated before the first report, and between repeats. */
  idleMs?: number;
  now?: () => number;
  emit?: (event: ProgressEventInput) => void;
}

export interface RunWatchdog {
  /** Record one SDK message's worth of activity, with the events it produced. */
  observe(events: readonly ProgressEventInput[]): void;
  /**
   * Record a retryable API failure. NOT activity — see the header: a retry is
   * the run failing to make progress, and the idle clock has to keep running
   * through it or the report never fires.
   */
  observeRetry(info: ApiRetryInfo): void;
  /**
   * Record a streaming token frame. NOT activity either, so the watchdog fires
   * on the same schedule whether or not the developer-only streaming option is
   * on — a diagnostic that changes the symptom is no use for diagnosing it.
   */
  observeStream(): void;
  /** Run the idle check once. Production drives this from a timer. */
  check(): void;
  /** One line describing what the run is waiting on, right now. */
  describe(): string;
  /** Begin the periodic check; returns a stop function. */
  start(): () => void;
}

function seconds(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function createRunWatchdog(opts?: RunWatchdogOptions): RunWatchdog {
  const idleMs = opts?.idleMs ?? DEFAULT_IDLE_MS;
  const now = opts?.now ?? Date.now;
  const emit = opts?.emit ?? defaultEmit;

  const inFlight = new Map<string, InFlight>();
  let lastActivityAt = now();
  // Tracked separately from lastActivityAt so a repeat fires every idleMs of
  // continued silence rather than only once.
  let lastReportAt = lastActivityAt;
  // The two explanations for a silent model turn. Both are cleared by real
  // activity: a retry that was followed by a successful call is history, and
  // reporting it against a LATER stall would name the wrong cause.
  let lastRetry: { info: ApiRetryInfo; at: number } | undefined;
  let lastStreamAt = 0;

  function oldestInFlight(): InFlight | undefined {
    let oldest: InFlight | undefined;
    for (const call of inFlight.values()) {
      if (!oldest || call.startedAt < oldest.startedAt) oldest = call;
    }
    return oldest;
  }

  /**
   * Why the model turn is silent, when we know.
   *
   * Appended to BOTH branches, not just the nothing-in-flight one: a fan-out
   * lead's `Agent` call stays in flight for its subagent's whole run, so a
   * retry storm inside that subagent surfaces under "waiting on Agent" — and
   * that is the case where the cause is hardest to guess from outside.
   */
  function cause(t: number): string {
    if (lastRetry) {
      const { attempt, maxRetries, error } = lastRetry.info;
      return ` (API retry ${attempt}/${maxRetries}, ${error}, last ${seconds(t - lastRetry.at)} ago)`;
    }
    // Only ever known when the streaming option is on. Absence is not
    // "no tokens" — it is "not measured" — so nothing is claimed here.
    if (lastStreamAt) return ` (model streaming, last token ${seconds(t - lastStreamAt)} ago)`;
    return "";
  }

  function describe(): string {
    const t = now();
    const oldest = oldestInFlight();
    if (oldest) {
      const what = oldest.summary ? `${oldest.tool} (${oldest.summary})` : oldest.tool;
      return `waiting on ${what} for ${seconds(t - oldest.startedAt)}${cause(t)}`;
    }
    return `no tool in flight — waiting on the model for ${seconds(t - lastActivityAt)}${cause(t)}`;
  }

  return {
    observe(events) {
      lastActivityAt = now();
      lastReportAt = lastActivityAt;
      lastRetry = undefined;
      lastStreamAt = 0;
      for (const e of events) {
        if (!e.toolUseId) continue;
        if (e.kind === "tool_result") {
          inFlight.delete(e.toolUseId);
          continue;
        }
        // Every other kind carrying a call id IS a call going out — including
        // the git_commit/git_push/gh_action rewrites of a Bash command.
        const tool = "tool" in e && typeof e.tool === "string" ? e.tool : e.kind;
        const summary = "summary" in e && typeof e.summary === "string" ? e.summary : "";
        inFlight.set(e.toolUseId, { tool, summary, startedAt: now() });
      }
    },

    observeRetry(info) {
      lastRetry = { info, at: now() };
    },

    observeStream() {
      lastStreamAt = now();
    },

    check() {
      if (now() - lastReportAt < idleMs) return;
      lastReportAt = now();
      emit({ kind: "log", level: "warn", summary: `[watchdog] ${describe()}` });
    },

    describe,

    start() {
      // unref'd: the watchdog must never be the reason a finished run's process
      // stays alive — that would turn a diagnostic into the hang it reports on.
      const timer = setInterval(() => this.check(), Math.max(1_000, Math.floor(idleMs / 4)));
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
