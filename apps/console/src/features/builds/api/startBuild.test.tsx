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
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { components } from "../../../generated/aep-api";

// Starting a build reads the preflight afresh and approves the cross-project
// endpoints it lists: a build sent without them never asks for access. The
// platform resources the server derives from the design itself.

const BASE = "http://localhost/api/v1";
vi.mock("../../../api/client", async () => {
  const { default: createClient } = await import("openapi-fetch");
  return { client: createClient({ baseUrl: BASE, fetch: (request) => globalThis.fetch(request) }) };
});
vi.mock("../../spec/collab/specDoc", () => ({ useSpecFlush: () => async () => {} }));

const { useStartBuild } = await import("./builds");

type PreflightItem = components["schemas"]["PreflightItem"];
type BuildRequest = components["schemas"]["BuildRequest"];

let preflight: PreflightItem[] | "fails" = [];
let sent: BuildRequest[] = [];

const server = setupServer(
  http.get(`${BASE}/projects/:projectName/build/preflight`, () =>
    preflight === "fails"
      ? HttpResponse.json({ code: "internal_error", message: "compute build preflight: boom" }, { status: 500 })
      : HttpResponse.json({ needsInput: preflight.length > 0, needsResolution: false, items: preflight }),
  ),
  http.post(`${BASE}/projects/:projectName/build`, async ({ request }) => {
    sent.push((await request.json()) as BuildRequest);
    return HttpResponse.json({ tag: "v1" });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  sent = [];
  preflight = [];
});
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function startBuild() {
  const { result } = renderHook(() => useStartBuild("lunch"), { wrapper });
  result.current.mutate({ features: ["F1"], productWide: [] });
  await waitFor(() => expect(result.current.isPending).toBe(false));
  return result.current;
}

describe("starting a build", () => {
  it("sends no approval for a platform resource: the server derives it", async () => {
    preflight = [
      { component: "lunch-api", dependency: "lunch-db", kind: "platform-resource", description: "Postgres", resourceType: "postgres-cnpg", parameters: { instances: 1 } },
    ];
    const start = await startBuild();
    expect(start.data).toBe("v1");
    expect(sent[0]?.inputs).toEqual([]);
  });

  it("approves an unresolved cross-project endpoint", async () => {
    preflight = [{ component: "lunch-api", dependency: "billing", kind: "org-service", description: "Billing" }];
    await startBuild();
    expect(sent[0]?.inputs).toEqual([{ component: "lunch-api", dependency: "billing", kind: "org-service", approved: true }]);
  });

  it("approves nothing when the preflight lists nothing", async () => {
    await startBuild();
    expect(sent[0]).toEqual({ inputs: [], selection: { features: ["F1"], productWide: [] } });
  });

  it("does not start a build whose preflight cannot be read", async () => {
    preflight = "fails";
    const start = await startBuild();
    expect(start.error?.message).toBe("compute build preflight: boom");
    expect(sent).toEqual([]);
  });
});
