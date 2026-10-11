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

import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// The design model on a real project: worked out from the room's design
// files, which carry no design revisions, and the design-review turn running
// now, read from the chat.

const ROOT = "../../../../../evals/spec-agents/scenarios/fixtures/expense-tracker-design/";
const raw = import.meta.glob<string>(
  "../../../../../evals/spec-agents/scenarios/fixtures/expense-tracker-design/specs/**/*.{md,json,yaml,cell,dsl,feature}",
  { query: "?raw", import: "default", eager: true },
);
const files = Object.fromEntries(Object.entries(raw).map(([path, content]) => [path.slice(ROOT.length), content]));

vi.mock("../spec/collab/specDoc", () => ({ useSpecDoc: () => null }));
vi.mock("../spec/collab/useRoomFiles", () => ({ useRoomFiles: () => files }));
let turn: { phase: string; instruction?: string } = { phase: "idle" };
vi.mock("../agent-chat/useProjectChat", () => ({ useProjectChat: () => ({ turn }) }));
vi.mock("../../api/client", () => ({ client: { GET: async () => ({ data: { items: [] } }) } }));

const { useDesignModel } = await import("./useDesignModel");

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("useDesignModel on the platform", () => {
  it("tracks no revision, and reads the design's artifacts from the room", async () => {
    turn = { phase: "idle" };
    const { result } = renderHook(() => useDesignModel("s0"), { wrapper });
    await waitFor(() => expect(result.current.data?.artifacts.length).toBeGreaterThan(0));
    expect(result.current.data?.revision).toBeNull();
    expect(result.current.data?.running).toBeNull();
  });

  it("says which design-review turn runs: a design, or Address comments", async () => {
    turn = { phase: "running", instruction: "/design F1 F2" };
    const designing = renderHook(() => useDesignModel("s0"), { wrapper });
    await waitFor(() => expect(designing.result.current.data?.running).toEqual({ kind: "design", features: ["F1", "F2"] }));
    turn = { phase: "running", instruction: "/address-comments" };
    const addressing = renderHook(() => useDesignModel("s0"), { wrapper });
    await waitFor(() => expect(addressing.result.current.data?.running).toEqual({ kind: "address", features: [] }));
  });
});
