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

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OxygenTheme, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

// A merge's builds are read live from OpenChoreo, which keeps a build only for
// its builder workflow's TTL. The panel tails a running build through the
// server's cursor, and says plainly when a build, or a whole merge's builds,
// are no longer kept, instead of reading as broken or not started.

const BASE = "http://localhost/api/v1";
vi.mock("../../../api/client", async () => {
  const { default: createClient } = await import("openapi-fetch");
  return { client: createClient({ baseUrl: BASE, fetch: (request) => globalThis.fetch(request) }) };
});

const { BuildLogs } = await import("./BuildLogs");

type CycleBuildList = components["schemas"]["CycleBuildList"];
type BuildLogs = components["schemas"]["BuildLogs"];

const build = { component: "notes-api", buildName: "shop-notes-api-3a982eb7bb13-1", status: "Running", completed: false, attempt: 1 };

let list: CycleBuildList = { items: [build] };
let reads: (BuildLogs | "expired")[] = [];
let cursors: (string | null)[] = [];

const server = setupServer(
  http.get(`${BASE}/projects/:projectName/builds/:tag/cycles/:cycleId/builds`, () => HttpResponse.json(list)),
  http.get(`${BASE}/projects/:projectName/components/:componentName/builds/:buildName/logs`, ({ request }) => {
    cursors.push(new URL(request.url).searchParams.get("cursor"));
    const next = reads.shift() ?? { logs: [], complete: true };
    if (next === "expired") return HttpResponse.json({ code: "build_expired", message: "this build is no longer kept" }, { status: 410 });
    return HttpResponse.json(next);
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  list = { items: [build] };
  reads = [];
  cursors = [];
});
afterAll(() => server.close());

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <OxygenUIThemeProvider theme={OxygenTheme}>
      <QueryClientProvider client={queryClient}>
        <BuildLogs projectName="shop" version="v1" cycleId="c1" />
      </QueryClientProvider>
    </OxygenUIThemeProvider>,
  );
}

describe("BuildLogs", () => {
  it("tails a running build from the cursor the server handed back", async () => {
    reads = [
      { logs: [{ log: ">> Branch: main", timestamp: "2026-10-12T16:47:20.835000001Z" }], complete: false, nextCursor: "2026-10-12T16:47:20.835000001Z" },
      { logs: [{ log: "build done", timestamp: "2026-10-12T16:50:20.775599808Z" }], complete: true, nextCursor: "2026-10-12T16:50:20.775599808Z" },
    ];
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Show log" }));

    expect(await screen.findByText(/>> Branch: main/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/build done/)).toBeTruthy(), { timeout: 4_000 });
    expect(cursors).toEqual([null, "2026-10-12T16:47:20.835000001Z"]);
    expect(screen.queryByText(/…tailing/)).toBeNull();
  });

  it("says a build OpenChoreo no longer keeps has no log, without an error", async () => {
    reads = ["expired"];
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Show log" }));
    expect(await screen.findByText(/This build is no longer kept/)).toBeTruthy();
  });

  it("says a merge's builds expired instead of 'not reached the cluster'", async () => {
    list = { items: [], expired: true };
    renderPanel();
    expect(await screen.findByText(/This merge's builds are no longer kept/)).toBeTruthy();
    expect(screen.queryByText(/has not reached the cluster/)).toBeNull();
  });

  it("still says a fresh merge has not reached the cluster", async () => {
    list = { items: [] };
    renderPanel();
    expect(await screen.findByText(/has not reached the cluster's builds yet/)).toBeTruthy();
  });
});
