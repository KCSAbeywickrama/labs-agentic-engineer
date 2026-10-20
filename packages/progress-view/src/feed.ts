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

// THE RUN FEED: one run's progress stream, folded once, as frames arrive.
//
// The stream's frames split FACTS from STATE (the contract's
// stream-run-progress): an `event` is a fact, keyed by (cycleId, attempt, seq),
// never retracted; a `cycle` is the whole cycle record, re-sent whenever it
// changes, newest wins; a `tick` is the platform's clock on a quiet stream; and
// `done` ends the run. This store is that rule as code, so a surface reads a
// model and never re-derives one per render.
//
// Framework-free and synchronous: `apply` folds one frame and says whether
// anything changed, `snapshot` returns an immutable view, `subscribe` says when
// to read it again. Scheduling (how often a view re-reads) is the view's call —
// a model that batched on its own clock could not be driven frame by frame by
// its tests.

import type { RunEventView } from "./event.js";

/**
 * Startup state of an open cycle's current attempt: the contract's
 * RunCycleBoot. Declared structurally, like RunEventView, so this package
 * depends on neither generated type set.
 */
export interface BootView {
  attempt: number;
  code: string;
  detail?: string | undefined;
  since: string;
}

/** The subset of the contract's RunCycleView the feed reads. */
export interface FeedCycleView {
  id: string;
  attempts?: number | undefined;
  endedAt?: string | null | undefined;
  boot?: BootView | undefined;
}

/** One frame of the stream: the contract's RunProgressEvent, structurally. */
export interface FeedFrame<C, E> {
  type: string;
  cycle?: C | undefined;
  cycleId?: string | undefined;
  attempt?: number | undefined;
  event?: E | undefined;
  state?: string | undefined;
  serverTime?: string | undefined;
}

/**
 * One event with the frame's stamps folded on. `cycleId` and `attempt` live on
 * the FRAME, because a runner knows what it is doing but not which cycle of
 * which run it turned out to be; folding them on lets everything downstream key
 * on one value.
 */
export type StampedEvent<E> = E & { cycleId: string; attempt: number };

/** The identity of one event: the dedup key, and a list key a surface can use. */
export function eventKey(e: { cycleId: string; attempt: number; seq?: number | undefined }): string {
  return `${e.cycleId}:${String(e.attempt)}:${String(e.seq)}`;
}

/** One cycle as the feed holds it. Replaced, never mutated, when it changes. */
export interface CycleFeed<C, E> {
  cycle: C;
  /** Every attempt's events, in arrival order, deduped. Facts only. */
  events: readonly StampedEvent<E>[];
  /** The newest attempt anything has spoken of: the cycle record's count, or an event's stamp. */
  attempt: number;
  /**
   * Where the newest attempt's runner is in starting up, while it has said
   * nothing yet. The cycle record's `boot`, else what an older aep-api sent as
   * a notice (see `LEGACY_BOOT_CODES`). Undefined once the attempt's first
   * event lands, whatever a not-yet-refreshed cycle record still says.
   */
  boot?: BootView | undefined;
}

export interface RunFeedSnapshot<C, E> {
  /** Cycles in the order their records first arrived (dispatch order). */
  cycles: readonly CycleFeed<C, E>[];
  /** The run's terminal state, from the `done` frame. */
  settledState?: string | undefined;
  /**
   * Platform clock minus this client's clock, in ms, as estimated from
   * `serverTime`. Every age a surface shows is measured against event `ts`,
   * which the cluster stamped; `Date.now() + clockOffsetMs` is the platform's
   * now. Zero until a frame carried a `serverTime`.
   */
  clockOffsetMs: number;
  /** This client's clock when the newest frame arrived. */
  lastFrameAt?: number | undefined;
  /**
   * Has the stream ever sent a `tick`? Only then does a long quiet stretch
   * mean the connection, rather than the run, went quiet — a server that sends
   * no ticks leaves a quiet run and a dead connection looking the same.
   */
  ticking: boolean;
}

/**
 * The six pod-truth startup codes an older aep-api sent as negative-seq
 * notices, before startup became RunCycleView.boot. Read as the cycle's boot
 * state and never kept as events: they were state riding the fact channel, and
 * kept as facts the first one stayed at the bottom of a newest-first log for
 * the rest of the run (build v1, 2026-10-12). Delete with the compatibility
 * window, once no aep-api in service sends them.
 */
const LEGACY_BOOT_CODES = new Set([
  "runner_scheduling",
  "runner_unschedulable",
  "runner_pulling_image",
  "runner_image_pull_backoff",
  "runner_config_error",
  "runner_starting",
]);

/** How many clock samples the offset is estimated over. */
const CLOCK_SAMPLES = 20;

interface CycleState<C, E> {
  cycle: C;
  events: StampedEvent<E>[];
  /** Attempts that have produced a real (non-negative seq) event. */
  spoken: Set<number>;
  maxEventAttempt: number;
  legacyBoot?: BootView | undefined;
  /** Bumped on every change; the snapshot rebuilds a cycle only when it moved. */
  version: number;
  view?: { version: number; feed: CycleFeed<C, E> } | undefined;
}

export class RunFeed<C extends FeedCycleView, E extends RunEventView> {
  private readonly cycles = new Map<string, CycleState<C, E>>();
  /** Events that outran their cycle's record, by cycle id. */
  private readonly orphans = new Map<string, StampedEvent<E>[]>();
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly clockSamples: number[] = [];
  private settledState: string | undefined;
  private lastFrameAt: number | undefined;
  private ticking = false;
  private cached: RunFeedSnapshot<C, E> | undefined;

  /**
   * Fold one frame. Returns whether the snapshot changed, and notifies
   * subscribers when it did. `receivedAt` is this client's clock at arrival.
   */
  apply(frame: FeedFrame<C, E>, receivedAt: number = Date.now()): boolean {
    let changed = this.observeClock(frame, receivedAt);
    switch (frame.type) {
      case "cycle":
        if (frame.cycle) changed = this.upsertCycle(frame.cycle) || changed;
        break;
      case "event":
        if (frame.event && frame.cycleId) {
          changed = this.addEvent({ ...frame.event, cycleId: frame.cycleId, attempt: frame.attempt ?? 0 }) || changed;
        }
        break;
      case "tick":
        if (!this.ticking) {
          this.ticking = true;
          changed = true;
        }
        break;
      case "done":
        if (frame.state && frame.state !== this.settledState) {
          this.settledState = frame.state;
          changed = true;
        }
        break;
      // `line` (v1) is not folded: aep-api lifts v1 cycles into v2 events
      // server-side, so one envelope reaches a surface.
    }
    if (changed) {
      this.cached = undefined;
      for (const l of this.listeners) l();
    }
    return changed;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The current view. The same object until something changes. */
  snapshot(): RunFeedSnapshot<C, E> {
    if (this.cached) return this.cached;
    const cycles = [...this.cycles.values()].map((c) => this.cycleView(c));
    this.cached = {
      cycles,
      settledState: this.settledState,
      clockOffsetMs: this.clockSamples.length ? Math.max(...this.clockSamples) : 0,
      lastFrameAt: this.lastFrameAt,
      ticking: this.ticking,
    };
    return this.cached;
  }

  /**
   * One clock sample per frame. The offset is the LARGEST recent sample: a
   * frame can only arrive after it was written, so every sample is the true
   * offset minus that frame's delay, and the least-delayed one is the closest.
   * A replay burst parses minutes of frames at once, which is why a mean would
   * be wrong. Recent only, so drift over a five-hour run is followed.
   */
  private observeClock(frame: FeedFrame<C, E>, receivedAt: number): boolean {
    this.lastFrameAt = receivedAt;
    const server = frame.serverTime ? Date.parse(frame.serverTime) : NaN;
    if (Number.isNaN(server)) return false;
    this.clockSamples.push(server - receivedAt);
    if (this.clockSamples.length > CLOCK_SAMPLES) this.clockSamples.shift();
    // Only a tick reports a changed clock on its own: every other frame is a
    // change already, and a surface reading ages re-reads on its own ticker.
    return frame.type === "tick";
  }

  private upsertCycle(cycle: C): boolean {
    const held = this.cycles.get(cycle.id);
    if (held) {
      // A re-sent record is fresher state about the same cycle (its pull
      // request, its recording, its boot), never a reset of its events.
      held.cycle = cycle;
      held.version++;
      return true;
    }
    const state: CycleState<C, E> = { cycle, events: [], spoken: new Set(), maxEventAttempt: 0, version: 0 };
    this.cycles.set(cycle.id, state);
    // An event frame carries its cycle's id and nothing else about it, so one
    // that outran its cycle record was held rather than filed under an invented
    // kind; it lands now, nothing lost and nothing made up.
    for (const e of this.orphans.get(cycle.id) ?? []) this.place(state, e);
    this.orphans.delete(cycle.id);
    return true;
  }

  private addEvent(e: StampedEvent<E>): boolean {
    const key = eventKey(e);
    // A reconnect replays from the start and a producer may retry a flush:
    // the same triple again is a no-op, which is what makes replay idempotent.
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    const state = this.cycles.get(e.cycleId);
    if (!state) {
      this.orphans.set(e.cycleId, [...(this.orphans.get(e.cycleId) ?? []), e]);
      return false;
    }
    this.place(state, e);
    return true;
  }

  private place(state: CycleState<C, E>, e: StampedEvent<E>): void {
    state.version++;
    state.maxEventAttempt = Math.max(state.maxEventAttempt, e.attempt);
    const seq = e.seq ?? 0;
    if (seq < 0 && e.kind === "notice" && e.code && LEGACY_BOOT_CODES.has(e.code)) {
      state.legacyBoot = { attempt: e.attempt, code: e.code, detail: e.detail, since: e.ts ?? "" };
      return;
    }
    if (seq >= 0) state.spoken.add(e.attempt);
    state.events.push(e);
  }

  private cycleView(state: CycleState<C, E>): CycleFeed<C, E> {
    if (state.view?.version === state.version) return state.view.feed;
    const attempt = Math.max(state.cycle.attempts ?? 0, state.maxEventAttempt);
    const feed: CycleFeed<C, E> = {
      cycle: state.cycle,
      // A copy: a surface may hold the previous view while this one grows.
      events: state.events.slice(),
      attempt,
      boot: this.bootOf(state, attempt),
    };
    state.view = { version: state.version, feed };
    return feed;
  }

  /**
   * The boot state worth showing: only for the newest attempt of an open
   * cycle, and only until that attempt's first real event. The record's own
   * `boot` outranks a legacy notice; the event rule outranks both, because a
   * cycle record re-sent a moment late must not put "Starting the agent…" back
   * over an agent that is already talking.
   */
  private bootOf(state: CycleState<C, E>, attempt: number): BootView | undefined {
    if (state.cycle.endedAt) return undefined;
    const boot = state.cycle.boot ?? state.legacyBoot;
    if (!boot || boot.attempt < attempt || state.spoken.has(boot.attempt)) return undefined;
    return boot;
  }
}
