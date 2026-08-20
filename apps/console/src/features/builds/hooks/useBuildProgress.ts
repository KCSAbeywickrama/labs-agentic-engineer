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

import { useEffect, useRef, useState } from "react";
import { parseSseStream } from "@aep/agent-stream";
import { client } from "../../../api/client";
import type { components } from "../../../generated/aep-api";
import {
  runLineKey,
  type RunProgressCycle,
  type RunProgressPhase,
} from "./useRunProgress";

type BuildProgressEvent = components["schemas"]["BuildProgressEvent"];
type BuildProgressRun = components["schemas"]["BuildProgressRun"];
type RunProgressLine = components["schemas"]["RunProgressLine"];
type RunCycleView = components["schemas"]["RunCycleView"];

/** One run's section of the version's timeline: which run, and its cycles. */
export interface BuildProgressRunSection {
  run: BuildProgressRun;
  cycles: RunProgressCycle[];
}

export interface BuildProgressState {
  /** Runs oldest first, each holding its cycles in dispatch order — the order
   *  the server emits, which is the narrative's own direction. */
  runs: BuildProgressRunSection[];
  /** Why the stream ended, from the `done` frame. `no_live_run` is the only
   *  value, and it is NOT "the version is finished" — see the hook's note. */
  settledReason: string | undefined;
  phase: RunProgressPhase;
}

const RECONNECT_DELAY_MS = 3_000;

async function openBuildStream(
  projectName: string,
  tag: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const { data, error } = await client.GET(
    "/projects/{projectName}/builds/{tag}/progress",
    {
      params: { path: { projectName, tag } },
      parseAs: "stream",
      signal,
    },
  );
  if (error || !data) throw new Error("Failed to attach to the version feed");
  return data as ReadableStream<Uint8Array>;
}

/**
 * Attach to ONE VERSION's progress stream and accumulate it grouped by run,
 * then by cycle.
 *
 * People think in versions, not executions, but a version's story is spread
 * across several runs — a dev run delivers it, a task run repairs a defect in
 * it, a validation run re-judges it. This is that story as one narrative;
 * useRunProgress stays the read for a single execution.
 *
 * TWO GROUPING LEVELS, DELIBERATELY. `cycleIndex` is run-relative on the wire
 * (the contract says so, and both streams honour it), so a cycle is only
 * identified once you know its run — which is why the run is the outer group
 * and the frame's `run` object is what keys it.
 *
 * ENDED IS NOT FINISHED. The server settles the stream when no run on the
 * milestone is live, which is an ordinary resting state rather than an outcome:
 * a dev run settles and a validation run may start much later, or never. So the reopen trigger is `reopenKey` — a value derived
 * from the caller's run-list poll (which it already makes every 5s). When it
 * changes after the stream has ended, the hook reattaches; while the stream is
 * still open it does nothing, because the server picks a new run up on its own
 * tick. Reattaching keeps the accumulated timeline: a re-derive is idempotent by
 * contract (cycles upsert by id, lines dedup by key), which is the same property
 * that makes a dropped connection safe to retry.
 *
 * Passing no tag, or `enabled: false`, keeps the hook inert — no stream is
 * opened, and the phase is `idle` rather than a connection state nobody asked
 * for.
 */
export function useBuildProgress(
  projectName: string,
  tag: string | undefined,
  /** Changes when the caller's run list changes. See ENDED IS NOT FINISHED. */
  reopenKey: string,
  enabled = true,
): BuildProgressState {
  const [runs, setRuns] = useState<BuildProgressRunSection[]>([]);
  const [settledReason, setSettledReason] = useState<string>();
  const [phase, setPhase] = useState<RunProgressPhase>("idle");
  const [reopens, setReopens] = useState(0);
  const seen = useRef(new Set<string>());
  // Settled-ness as a REF, not the phase state: the reopen effect must not
  // re-run when the phase moves, only when the run list does.
  const settled = useRef(false);

  // A different version is a different story — start over. A REOPEN is not, so
  // this deliberately does not depend on `reopens`: the accumulated timeline is
  // what a reopen adds to.
  useEffect(() => {
    seen.current = new Set();
    setRuns([]);
    setSettledReason(undefined);
  }, [projectName, tag]);

  useEffect(() => {
    if (!settled.current) return;
    settled.current = false;
    setReopens((n) => n + 1);
  }, [reopenKey]);

  useEffect(() => {
    if (!tag || !enabled) {
      setPhase("idle");
      return;
    }
    setPhase("connecting");

    const controller = new AbortController();
    let disposed = false;

    // Runs are appended in ARRIVAL order, which the server promises is
    // chronological — so the narrative reads forwards without the client
    // sorting anything, and a run admitted later lands at the end where it
    // belongs. `index` is carried for the label only.
    const upsertRun = (
      run: BuildProgressRun,
      update: (cycles: RunProgressCycle[]) => RunProgressCycle[],
    ) =>
      setRuns((prev) => {
        const i = prev.findIndex((s) => s.run.id === run.id);
        if (i === -1) return [...prev, { run, cycles: update([]) }];
        const next = prev.slice();
        const at = prev[i];
        if (!at) return prev;
        next[i] = { run, cycles: update(at.cycles) };
        return next;
      });

    const upsertCycle = (run: BuildProgressRun, cycle: RunCycleView) =>
      upsertRun(run, (cycles) => {
        const i = cycles.findIndex((c) => c.cycle.id === cycle.id);
        if (i === -1) return [...cycles, { cycle, lines: [] }];
        const next = cycles.slice();
        // Keep the accumulated lines: a re-emitted cycle record is fresher
        // metadata (branch, PR, merge SHA learned from webhooks), not a reset.
        next[i] = { cycle, lines: cycles[i]?.lines ?? [] };
        return next;
      });

    const appendLine = (run: BuildProgressRun, line: RunProgressLine) =>
      upsertRun(run, (cycles) => {
        const i = cycles.findIndex((c) => c.cycle.id === line.cycleId);
        if (i === -1) {
          // A line can outrun its cycle frame on a reconnect; the line carries
          // enough attribution to open the section itself.
          return [
            ...cycles,
            {
              cycle: {
                id: line.cycleId,
                kind: line.cycleKind as RunCycleView["kind"],
                attempts: 0,
                createdAt: line.ts ?? "",
              },
              lines: [line],
            },
          ];
        }
        const next = cycles.slice();
        const at = cycles[i];
        if (!at) return cycles;
        next[i] = { cycle: at.cycle, lines: [...at.lines, line] };
        return next;
      });

    const consume = async (): Promise<"done" | "eof"> => {
      const body = await openBuildStream(projectName, tag, controller.signal);
      setPhase("live");
      const frames = parseSseStream(body);
      while (true) {
        const next = await frames.next();
        if (next.done) return next.value;
        const event = next.value as unknown as BuildProgressEvent;
        switch (event.type) {
          case "cycle":
            if (event.run && event.cycle) upsertCycle(event.run, event.cycle);
            break;
          case "line": {
            const line = event.line;
            if (!event.run || !line) break;
            // Keyed on the cycle, not the run: a cycle id is unique across runs,
            // so this is the same key the per-run feed dedups on.
            const key = runLineKey(line);
            if (seen.current.has(key)) break;
            seen.current.add(key);
            appendLine(event.run, line);
            break;
          }
          case "done":
            if (event.reason) setSettledReason(event.reason);
            break;
        }
      }
    };

    const run = async () => {
      while (!disposed) {
        try {
          const end = await consume();
          if (end === "done") {
            settled.current = true;
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
  }, [projectName, tag, enabled, reopens]);

  return { runs, settledReason, phase };
}
