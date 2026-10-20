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

// One SSE body per attach; `open` keeps the body open after its frames, as a
// live task's stream is.
let bodies: { text: string; open?: boolean }[] = [];
const GET = vi.fn(() => {
  const body = bodies.shift() ?? { text: "" };
  return Promise.resolve({
    data: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body.text));
        if (!body.open) controller.close();
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

import { useTaskLog } from "./useTaskLog";

function frames(...events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const task = { type: "task", task: { issueNumber: 7, kind: "development" } };
const DONE = "data: [DONE]\n\n";

afterEach(() => {
  bodies = [];
  GET.mockClear();
});

describe("useTaskLog", () => {
  it("is live, with no lines, while an attached stream has written none", async () => {
    bodies = [{ text: frames(task), open: true }];
    const { result, unmount } = renderHook(() => useTaskLog("shop", 7));
    expect(result.current.phase).toBe("connecting");
    await waitFor(() => expect(result.current.phase).toBe("live"));
    expect(result.current.lines).toEqual([]);
    unmount();
  });

  it("ends, without reattaching, when the server closes a task with no log of its own", async () => {
    // aep-api's answer for a coding task: its task frame, then done and [DONE].
    bodies = [{ text: frames(task, { type: "done", derivedStatus: "pending" }) + DONE }];
    const { result } = renderHook(() => useTaskLog("shop", 7));
    await waitFor(() => expect(result.current.phase).toBe("ended"));
    expect(result.current.lines).toEqual([]);
    expect(result.current.kind).toBe("development");
    expect(GET).toHaveBeenCalledTimes(1);
  });

  it("keeps each execution's newest report", async () => {
    const exec = { id: "x1", kind: "provision", createdAt: "2026-10-19T07:44:33Z" };
    bodies = [
      {
        text:
          frames(
            task,
            { type: "execution", execution: { ...exec, status: "running" } },
            { type: "execution", execution: { ...exec, status: "succeeded", reason: "ready" } },
            { type: "done", derivedStatus: "merged" },
          ) + DONE,
      },
    ];
    const { result } = renderHook(() => useTaskLog("shop", 7));
    await waitFor(() => expect(result.current.phase).toBe("ended"));
    expect(result.current.executions).toEqual([{ ...exec, status: "succeeded", reason: "ready" }]);
  });
});
