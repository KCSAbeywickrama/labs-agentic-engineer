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

import { afterEach, describe, expect, it } from "vitest";
import { startStubServer } from "../src/stub-server.js";

const SPEC = {
  openapi: "3.0.0",
  paths: {
    "/hotels": {
      get: {
        operationId: "listHotels",
        responses: {
          "200": {
            content: {
              "application/json": {
                example: [{ id: "h1", name: "The Kensington", price: 210 }],
              },
            },
          },
        },
      },
    },
  },
};

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

describe("startStubServer", () => {
  it("serves the contract's example for an operation", async () => {
    const s = await startStubServer(SPEC);
    stop = s.close;
    const body = await (await fetch(`${s.url}/hotels`)).json();
    expect(body[0].name).toBe("The Kensington");
  });

  // Same input, same output, every iteration — otherwise a score change cannot
  // be attributed to the prompt.
  it("answers identically across calls", async () => {
    const s = await startStubServer(SPEC);
    stop = s.close;
    const a = await (await fetch(`${s.url}/hotels`)).text();
    const b = await (await fetch(`${s.url}/hotels`)).text();
    expect(a).toBe(b);
  });

  it("records which operations the agent actually called", async () => {
    const s = await startStubServer(SPEC);
    stop = s.close;
    await fetch(`${s.url}/hotels`);
    expect(s.calls.map((c) => c.operationId)).toEqual(["listHotels"]);
  });

  // An unmodelled path must be visibly absent, not silently empty — otherwise a
  // tool calling the wrong URL looks like a tool returning no results.
  it("404s a path the contract does not define", async () => {
    const s = await startStubServer(SPEC);
    stop = s.close;
    expect((await fetch(`${s.url}/nope`)).status).toBe(404);
  });

  // `allow` is the agent's security boundary. Serving the whole contract
  // regardless would answer 200 to an operation the agent may not call, which
  // can only hide an over-reach — never enable one, since the built agent
  // carries no tool for it — in the one place it is cheap to see.
  it("403s an operation the contract defines but the allow-list withholds", async () => {
    const s = await startStubServer(SPEC, []);
    stop = s.close;
    const res = await fetch(`${s.url}/hotels`);
    // 403, not 404: the operation is real, so a fix round must not be sent
    // after a contract that is perfectly fine.
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("listHotels");
    expect(s.calls[0]!.denied).toBe(true);
  });

  it("still serves an allow-listed operation, and records it as permitted", async () => {
    const s = await startStubServer(SPEC, ["listHotels"]);
    stop = s.close;
    expect((await fetch(`${s.url}/hotels`)).status).toBe(200);
    expect(s.calls[0]!.denied).toBeUndefined();
  });

  it("refuses an allow entry the contract does not define", async () => {
    await expect(startStubServer(SPEC, ["bookHotel"])).rejects.toThrow(/bookHotel/);
  });
});
