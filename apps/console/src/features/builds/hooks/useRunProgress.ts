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

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { parseSseStream } from "@aep/agent-stream";
import { RunFeed, type CycleFeed, type RunFeedSnapshot, type StampedEvent } from "@aep/progress-view";
import { client } from "../../../api/client";
import type { components } from "../../../generated/aep-api";

type RunProgressEvent = components["schemas"]["RunProgressEvent"];
type RunEvent = components["schemas"]["RunEvent"];
type RunCycleView = components["schemas"]["RunCycleView"];

/**
 * One v2 event as the feed holds it: the frame's `cycleId` and `attempt`
 * folded onto the event (see StampedEvent in `@aep/progress-view`).
 */
export type StampedRunEvent = StampedEvent<RunEvent>;

/**
 * Where the stream is.
 *
 * `idle` is NOT a connection state: it means nobody asked for one (the hook was
 * called with `enabled: false`). It exists because reporting `connecting` for a
 * stream that was never opened made a collapsed, connection-free surface tell the
 * user it was "attaching to the run feed" forever.
 */
export type RunProgressPhase =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "ended";

/** One cycle's section of the feed: the cycle record, its events, its newest attempt and startup state. */
export type RunProgressCycle = CycleFeed<RunCycleView, RunEvent>;

/** The run's feed as the store folded it, plus where the connection is. */
export interface RunProgressState extends RunFeedSnapshot<RunCycleView, RunEvent> {
  phase: RunProgressPhase;
  /** Drop the connection and attach afresh. The replay is idempotent, so this is
   *  what a "Try again" on an unavailable log calls. */
  reconnect: () => void;
}

const RECONNECT_DELAY_MS = 3_000;

async function openRunStream(
  projectName: string,
  runId: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const { data, error } = await client.GET(
    "/projects/{projectName}/runs/{runId}/progress",
    {
      params: { path: { projectName, runId } },
      parseAs: "stream",
      signal,
    },
  );
  if (error || !data) throw new Error("Failed to attach to the run feed");
  return data as ReadableStream<Uint8Array>;
}

/**
 * Subscribe to the feed, telling React at most once per task. A replay parses
 * minutes of frames in one burst; one render for the burst, not one per frame.
 */
function subscribeCoalesced(feed: RunFeed<RunCycleView, RunEvent>, listener: () => void): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const off = feed.subscribe(() => {
    pending ??= setTimeout(() => {
      pending = undefined;
      listener();
    }, 0);
  });
  return () => {
    off();
    if (pending) clearTimeout(pending);
  };
}

/**
 * Attach to ONE run's progress stream and fold it into a RunFeed.
 *
 * The folding is the store's (`@aep/progress-view`): events dedup by key and
 * append, cycle records replace, startup state never becomes a row, and the
 * clock offset comes from the frames' `serverTime`. This hook is only the
 * transport: the platform's standard agent SSE (`data:` JSON frames,
 * keep-alive comments, `[DONE]` sentinel), parsed by agent-stream exactly as
 * useTaskLog does. ONLY a terminal run settles the stream, so `ended` is a
 * fact about the run, not about the connection — an EOF without `[DONE]` is a
 * dropped connection to reattach, and the replay is idempotent.
 *
 * One feed per run, kept across reconnects: the replay dedups, so a reader
 * keeps what they had instead of watching the log empty and refill.
 *
 * Passing no runId keeps the hook inert — no stream is opened. That is how the
 * feed stays closed until the user opens it.
 */
export function useRunProgress(
  projectName: string,
  runId: string | undefined,
  /** Open the stream at all. False keeps a page that nobody is watching
   *  connection-free — the property the old run-level feed toggle gave us. */
  enabled = true,
): RunProgressState {
  // A new run is a new feed; the hook instance survives a param update, so the
  // feed is replaced during render when the run changes (React's "adjust state
  // when a prop changes" pattern), never left serving the previous run.
  const runKey = `${projectName}/${runId ?? ""}`;
  const [held, setHeld] = useState(() => ({ runKey, feed: new RunFeed<RunCycleView, RunEvent>() }));
  let feed = held.feed;
  if (held.runKey !== runKey) {
    feed = new RunFeed<RunCycleView, RunEvent>();
    setHeld({ runKey, feed });
  }
  const subscribe = useCallback((listener: () => void) => subscribeCoalesced(feed, listener), [feed]);
  const snapshot = useSyncExternalStore(subscribe, () => feed.snapshot());
  const [phase, setPhase] = useState<RunProgressPhase>("idle");
  // Bumped by reconnect(); an effect dependency, so a bump re-runs the attach.
  const [attachment, setAttachment] = useState(0);
  const reconnect = useCallback(() => {
    setAttachment((n) => n + 1);
  }, []);

  useEffect(() => {
    // Not enabled = nobody is looking. A settled version whose cycles are all
    // collapsed must open no connection and replay no history — and must not
    // claim to be connecting either.
    if (!runId || !enabled) {
      setPhase("idle");
      return;
    }
    setPhase("connecting");

    const controller = new AbortController();
    let disposed = false;

    const consume = async (): Promise<"done" | "eof"> => {
      const body = await openRunStream(projectName, runId, controller.signal);
      setPhase("live");
      const frames = parseSseStream(body);
      while (true) {
        const next = await frames.next();
        if (next.done) return next.value;
        feed.apply(next.value as unknown as RunProgressEvent);
      }
    };

    const run = async () => {
      while (!disposed) {
        try {
          const end = await consume();
          if (end === "done") {
            setPhase("ended");
            return;
          }
        } catch {
          if (disposed) return;
        }
        setPhase("reconnecting");
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      }
    };
    void run();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [feed, projectName, runId, enabled, attachment]);

  return { ...snapshot, phase, reconnect };
}
