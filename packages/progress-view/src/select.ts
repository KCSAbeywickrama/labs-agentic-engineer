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

// What a surface reads off the run feed. Pure, and memoised on the identity of
// what the feed hands out: a CycleFeed (and its `events`) is replaced only when
// that cycle changed, so a cycle that did not move costs nothing to read again,
// and one session's traffic never re-folds another's.
//
// Anything that depends on time takes `now` as an argument. The surface's
// ticker is the only clock, and `crewAt` is the only part that runs per tick.

import { formatEvent, type RunEventView } from "./event.js";
import { crewAt, foldCrew, type Crew, type CrewFold } from "./crew.js";
import { mergeOutcomes } from "./group.js";
import { formatDuration, formatOutcome, LIFECYCLE_LABELS, type LineTone } from "./line.js";
import { eventKey, type BootView, type CycleFeed, type RunFeedSnapshot, type StampedEvent } from "./feed.js";

/** One step as a surface draws it: the action, with its outcome on the same row. */
export interface StepRow<E> {
  /** Stable across renders: the action event's identity. */
  key: string;
  ts?: string | undefined;
  agentId: string;
  text: string;
  tone: LineTone;
  /** What became of the action — exit code, failure, slow duration, background status. Empty when it says nothing. */
  outcome: { text: string; tone: LineTone };
  /** An agent's closing report, for a surface with room to show it under the row. */
  report?: string | undefined;
  /** The action event itself, for a surface that needs more than the words. */
  event: E;
}

const stepCache = new WeakMap<readonly object[], StepRow<object>[]>();

/**
 * One agent's steps (or any list of events), each outcome folded onto the
 * action it answers, oldest first, as a terminal prints them: a surface that
 * follows the tail appends below what its reader is reading. Silent events and
 * silent outcomes leave no row. The ONE place an event becomes a step row, for
 * every surface.
 */
export function stepRows<E extends StampedEvent<RunEventView>>(events: readonly E[]): StepRow<E>[] {
  const held = stepCache.get(events);
  if (held) return held as StepRow<E>[];
  const rows: StepRow<E>[] = [];
  for (const row of mergeOutcomes(events)) {
    const { text, tone, report } = formatEvent(row.line);
    if (!text) continue;
    const { detail, duration, tone: outcomeTone } = formatOutcome(row.outcome);
    // `background` rides the outcome column, where a reader looks to learn
    // what became of a row: on its own it says the command was detached and
    // has not come back; beside a status it says both what it was and how it
    // ended.
    const outcome = [row.backgrounded ? "background" : "", detail, duration].filter(Boolean).join(" · ");
    rows.push({
      key: eventKey(row.line),
      ts: row.line.ts,
      agentId: row.line.agentId,
      text,
      tone,
      outcome: { text: outcome, tone: outcomeTone },
      report,
      event: row.line,
    });
  }
  stepCache.set(events, rows as StepRow<object>[]);
  return rows;
}

/** The events of one attempt of a cycle, memoised on the cycle's events array. */
const attemptCache = new WeakMap<readonly object[], Map<number, readonly object[]>>();

export function attemptEvents<C, E extends RunEventView>(
  feed: CycleFeed<C, E>,
  attempt: number = feed.attempt,
): readonly StampedEvent<E>[] {
  let byAttempt = attemptCache.get(feed.events);
  if (!byAttempt) {
    byAttempt = new Map();
    attemptCache.set(feed.events, byAttempt);
  }
  const held = byAttempt.get(attempt);
  if (held) return held as readonly StampedEvent<E>[];
  const events = feed.events.filter((e) => e.attempt === attempt);
  byAttempt.set(attempt, events);
  return events;
}

const foldCache = new WeakMap<readonly object[], Map<string, CrewFold<object>>>();

/**
 * One cycle's crew at `now`, for its newest attempt (or the one asked for).
 *
 * The fold is memoised per (events, endedWith) and only `crewAt` runs per
 * tick, so a surface can re-read this every second on a 5,000-event cycle.
 *
 * While the attempt's runner has not spoken yet, the lead's caption is the
 * startup state, with how long it has been in it: the dark zone is the
 * slowest stretch of a run, and a blank lead row is what made it read as dead.
 */
export function cycleCrew<C, E extends RunEventView>(
  feed: CycleFeed<C, E>,
  now: number,
  opts: { attempt?: number | undefined; endedWith?: string | undefined } = {},
): Crew<StampedEvent<E>> {
  const events = attemptEvents(feed, opts.attempt);
  let byOutcome = foldCache.get(events);
  if (!byOutcome) {
    byOutcome = new Map();
    foldCache.set(events, byOutcome);
  }
  const memo = opts.endedWith ?? "";
  let fold = byOutcome.get(memo) as CrewFold<StampedEvent<E>> | undefined;
  if (!fold) {
    fold = foldCrew(events, opts.endedWith);
    byOutcome.set(memo, fold as CrewFold<object>);
  }
  const crew = crewAt(fold, now);
  const boot = (opts.attempt ?? feed.attempt) === feed.attempt ? feed.boot : undefined;
  // `crewAt` builds fresh members on every call, so the lead is this call's
  // own object to amend.
  if (boot) crew.lead.caption = bootSentence(boot, now);
  return crew;
}

/** "Pulling the agent image… · 14.0s" — a startup state, said with its age. */
export function bootSentence(boot: BootView, now: number): string {
  const label = LIFECYCLE_LABELS[boot.code] ?? boot.code;
  const since = Date.parse(boot.since);
  const parts = [label, boot.detail];
  if (!Number.isNaN(since) && now > since) parts.push(formatDuration(now - since));
  return parts.filter(Boolean).join(" · ");
}

/** The platform's now, by this client's clock and the feed's estimate of the offset. */
export function feedNow(snapshot: Pick<RunFeedSnapshot<unknown, RunEventView>, "clockOffsetMs">, clientNow: number): number {
  return clientNow + snapshot.clockOffsetMs;
}

/**
 * How long the CONNECTION has been quiet, when that is worth saying: only on
 * a stream that ticks (where silence past a couple of ticks means the
 * connection, not the run), else undefined. The run being quiet is the crew's
 * to say, per agent.
 */
export function connectionQuietMs(
  snapshot: Pick<RunFeedSnapshot<unknown, RunEventView>, "ticking" | "lastFrameAt" | "settledState">,
  clientNow: number,
): number | undefined {
  if (!snapshot.ticking || snapshot.settledState || snapshot.lastFrameAt === undefined) return undefined;
  const quiet = clientNow - snapshot.lastFrameAt;
  return quiet >= CONNECTION_QUIET_MS ? quiet : undefined;
}

/** Three missed ticks (the server sends one per 15s of quiet). */
export const CONNECTION_QUIET_MS = 45_000;
