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

// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// One SSE body per attach. The hook reconnects on EOF-without-[DONE], so a test
// that wants a single attach must end its body with the sentinel.
let bodies: string[] = [];
const GET = vi.fn(() => {
  const text = bodies.shift() ?? "";
  return Promise.resolve({
    data: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    error: undefined,
  });
});
// The factory is hoisted above `GET`'s initialiser, so it reads it lazily.
vi.mock("../../../api/client", () => ({
  client: {
    GET: (...args: unknown[]) => GET(...(args as [])),
  },
}));

import { useBuildProgress } from "./useBuildProgress";

function frames(...events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const run = (id: string, kind: string, index: number) => ({ id, kind, index });

const cycleFrame = (
  r: ReturnType<typeof run>,
  id: string,
  kind: string,
) => ({
  type: "cycle",
  run: r,
  cycle: { id, kind, attempts: 1, createdAt: "2026-07-10T09:00:00Z" },
});

const lineFrame = (
  r: ReturnType<typeof run>,
  cycleId: string,
  cycleKind: string,
  cycleIndex: number,
  seq: number,
  summary: string,
) => ({
  type: "line",
  run: r,
  line: {
    cycleId,
    cycleKind,
    cycleIndex,
    kind: "log",
    emitter: "main",
    seq,
    summary,
    ts: "2026-07-10T09:01:00Z",
  },
});

const SETTLED = { type: "done", reason: "no_live_run" };
const DONE = "data: [DONE]\n\n";

const dev = run("r1", "dev", 1);
const task = run("r2", "task", 2);

afterEach(() => {
  bodies = [];
  GET.mockClear();
});

describe("useBuildProgress", () => {
  it("opens nothing without a tag", () => {
    const { result } = renderHook(() => useBuildProgress("acme", undefined, ""));
    expect(GET).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("is idle, not connecting, while it is disabled", () => {
    const { result } = renderHook(() =>
      useBuildProgress("acme", "v3", "", false),
    );
    expect(GET).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  // The whole point: a version's story spans several runs, and the run is the
  // outer group because `cycleIndex` is run-relative — "cycle 1" of the task run
  // is not "cycle 1" of the spec build.
  it("groups cycles under the run that opened them, in arrival order", async () => {
    bodies = [
      frames(
        cycleFrame(dev, "c1", "coding"),
        lineFrame(dev, "c1", "coding", 1, 1, "dev first"),
        cycleFrame(dev, "c2", "fix"),
        lineFrame(dev, "c2", "fix", 2, 2, "dev second"),
        cycleFrame(task, "c3", "coding"),
        lineFrame(task, "c3", "coding", 1, 3, "task first"),
        SETTLED,
      ) + DONE,
    ];
    const { result } = renderHook(() => useBuildProgress("acme", "v3", "r1,r2"));

    await waitFor(() => expect(result.current.phase).toBe("ended"));
    expect(result.current.runs.map((s) => s.run.id)).toEqual(["r1", "r2"]);
    expect(result.current.runs.map((s) => s.run.kind)).toEqual(["dev", "task"]);
    expect(result.current.runs[0]?.cycles.map((c) => c.cycle.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(result.current.runs[1]?.cycles.map((c) => c.cycle.id)).toEqual([
      "c3",
    ]);
    expect(
      result.current.runs[1]?.cycles[0]?.lines.map((l) => l.summary),
    ).toEqual(["task first"]);
    // The stream ended because nothing is live — never a run state.
    expect(result.current.settledReason).toBe("no_live_run");
  });

  // The ordinary case, and it must not need special-casing: one run, one section.
  it("reads a version worked by a single run as one section", async () => {
    bodies = [
      frames(
        cycleFrame(dev, "c1", "coding"),
        lineFrame(dev, "c1", "coding", 1, 1, "only"),
        SETTLED,
      ) + DONE,
    ];
    const { result } = renderHook(() => useBuildProgress("acme", "v3", "r1"));

    await waitFor(() => expect(result.current.phase).toBe("ended"));
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0]?.run.index).toBe(1);
    expect(result.current.runs[0]?.cycles[0]?.lines).toHaveLength(1);
  });

  it("keeps a cycle's lines when its record is re-emitted with fresher facts", async () => {
    bodies = [
      frames(
        cycleFrame(dev, "c1", "coding"),
        lineFrame(dev, "c1", "coding", 1, 1, "first"),
        {
          type: "cycle",
          run: dev,
          cycle: {
            id: "c1",
            kind: "coding",
            attempts: 1,
            branch: "aep/m1-c1",
            prNumber: 3,
            createdAt: "2026-07-10T09:00:00Z",
          },
        },
        SETTLED,
      ) + DONE,
    ];
    const { result } = renderHook(() => useBuildProgress("acme", "v3", "r1"));

    await waitFor(() => expect(result.current.phase).toBe("ended"));
    expect(result.current.runs[0]?.cycles[0]?.cycle.branch).toBe("aep/m1-c1");
    expect(result.current.runs[0]?.cycles[0]?.lines).toHaveLength(1);
  });

  it("dedups a replayed line across a reconnect", async () => {
    // First attach ends WITHOUT [DONE] — a dropped connection, not a settled
    // stream — so the hook reattaches and the server replays from the start.
    bodies = [
      frames(
        cycleFrame(dev, "c1", "coding"),
        lineFrame(dev, "c1", "coding", 1, 1, "first"),
      ),
      frames(
        cycleFrame(dev, "c1", "coding"),
        lineFrame(dev, "c1", "coding", 1, 1, "first"),
        lineFrame(dev, "c1", "coding", 1, 2, "second"),
        SETTLED,
      ) + DONE,
    ];
    const { result } = renderHook(() => useBuildProgress("acme", "v3", "r1"));

    await waitFor(() => expect(result.current.phase).toBe("ended"), {
      timeout: 6000,
    });
    expect(GET).toHaveBeenCalledTimes(2);
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0]?.cycles).toHaveLength(1);
    expect(
      result.current.runs[0]?.cycles[0]?.lines.map((l) => l.summary),
    ).toEqual(["first", "second"]);
  }, 10000);

  // `ended` is a resting state, not an outcome: the server settles when no run
  // is live, and a validation or task run may be admitted much later. The
  // caller's run-list poll is the only thing that can notice, so a change to it
  // reattaches — and the timeline already on screen is added to, not rebuilt.
  it("reattaches when a new run appears after it settled", async () => {
    bodies = [
      frames(cycleFrame(dev, "c1", "coding"), SETTLED) + DONE,
      frames(cycleFrame(dev, "c1", "coding"), cycleFrame(task, "c9", "coding")) +
        frames(SETTLED) +
        DONE,
    ];
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useBuildProgress("acme", "v3", key),
      { initialProps: { key: "r1" } },
    );

    await waitFor(() => expect(result.current.phase).toBe("ended"));
    expect(GET).toHaveBeenCalledTimes(1);

    rerender({ key: "r1,r2" });

    await waitFor(() => expect(result.current.runs).toHaveLength(2));
    expect(GET).toHaveBeenCalledTimes(2);
    expect(result.current.runs.map((s) => s.run.id)).toEqual(["r1", "r2"]);
  });

  // …and while the stream is still OPEN the run list changing is not a reason to
  // reattach: the server picks a new run up on its own tick, and tearing the
  // connection down would replay everything for nothing.
  it("does not reattach while the stream is still open", async () => {
    // No [DONE] and no further body: the first attach stays open.
    bodies = [frames(cycleFrame(dev, "c1", "coding"))];
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useBuildProgress("acme", "v3", key),
      { initialProps: { key: "r1" } },
    );

    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    rerender({ key: "r1,r2" });
    expect(GET).toHaveBeenCalledTimes(1);
  });
});
