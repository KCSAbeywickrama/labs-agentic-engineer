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

import { describe, expect, it, vi } from "vitest";
import { createAuthFetch } from "./authFetch";

function deps(overrides: Partial<Parameters<typeof createAuthFetch>[0]> = {}) {
  return {
    getToken: vi.fn().mockResolvedValue("tok-1"),
    renewToken: vi.fn().mockResolvedValue("tok-2"),
    redirectToSignIn: vi.fn(),
    ...overrides,
  };
}

const ok = () => new Response("ok", { status: 200 });
const unauthorized = () => new Response("nope", { status: 401 });

describe("createAuthFetch", () => {
  it("attaches the Bearer token to every request", async () => {
    const fetch = vi.fn().mockResolvedValue(ok());
    const d = deps({ fetch });
    await createAuthFetch(d)("https://bff/api/v1/projects");

    const sent = fetch.mock.calls[0]![0] as Request;
    expect(sent.headers.get("Authorization")).toBe("Bearer tok-1");
    expect(d.renewToken).not.toHaveBeenCalled();
  });

  it("sends without a header when there is no session token", async () => {
    const fetch = vi.fn().mockResolvedValue(ok());
    const d = deps({ fetch, getToken: vi.fn().mockResolvedValue(null) });
    await createAuthFetch(d)("https://bff/api/v1/projects");

    const sent = fetch.mock.calls[0]![0] as Request;
    expect(sent.headers.get("Authorization")).toBeNull();
  });

  it("on 401: renews, retries once with the new token, returns the retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok());
    const d = deps({ fetch });
    const response = await createAuthFetch(d)("https://bff/api/v1/projects");

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    const retried = fetch.mock.calls[1]![0] as Request;
    expect(retried.headers.get("Authorization")).toBe("Bearer tok-2");
    expect(d.redirectToSignIn).not.toHaveBeenCalled();
  });

  it("preserves the request body on the retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok());
    const d = deps({ fetch });
    await createAuthFetch(d)("https://bff/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "demo" }),
      headers: { "Content-Type": "application/json" },
    });

    const retried = fetch.mock.calls[1]![0] as Request;
    expect(await retried.text()).toBe(JSON.stringify({ name: "demo" }));
    expect(retried.method).toBe("POST");
  });

  it("redirects to sign-in when renewal fails, returning the original 401", async () => {
    const fetch = vi.fn().mockResolvedValue(unauthorized());
    const d = deps({ fetch, renewToken: vi.fn().mockResolvedValue(null) });
    const response = await createAuthFetch(d)("https://bff/api/v1/projects");

    expect(response.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(d.redirectToSignIn).toHaveBeenCalledOnce();
  });

  it("redirects to sign-in when the retry still comes back 401", async () => {
    const fetch = vi.fn().mockResolvedValue(unauthorized());
    const d = deps({ fetch });
    const response = await createAuthFetch(d)("https://bff/api/v1/projects");

    expect(response.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(d.redirectToSignIn).toHaveBeenCalledOnce();
  });
});
