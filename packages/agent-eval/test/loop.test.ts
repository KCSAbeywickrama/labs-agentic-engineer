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
import { runFixLoop } from "../src/loop.js";
import type { Verdict } from "../src/verdict.js";

const verdict = (overall: number): Verdict => ({
  passed: overall >= 0.8,
  overall,
  scenarios: [{ id: "SC-1", score: overall, passed: overall >= 0.8, failed: [], ungraded: [] }],
});

describe("runFixLoop", () => {
  it("stops as soon as the evaluation passes", async () => {
    const evaluate = vi.fn().mockResolvedValue(verdict(0.9));
    const revise = vi.fn();
    const r = await runFixLoop({ evaluate, revise, body: "original" });
    expect(r.rounds).toBe(1);
    expect(revise).not.toHaveBeenCalled();
    expect(r.body).toBe("original");
  });

  // Unbounded iteration on a probabilistic system spends the org's key with no
  // guarantee of converging.
  it("never exceeds the cap", async () => {
    const evaluate = vi.fn().mockResolvedValue(verdict(0.2));
    const revise = vi.fn(async (_v, b: string) => `${b}+`);
    const r = await runFixLoop({ evaluate, revise, body: "x", maxRounds: 3 });
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(r.rounds).toBe(3);
  });

  // The loop can talk itself into a worse agent; the best prompt must ship.
  it("keeps the best-scoring body, not the last one tried", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(verdict(0.5))
      .mockResolvedValueOnce(verdict(0.7))
      .mockResolvedValueOnce(verdict(0.3));
    const revise = vi.fn(async (_v, b: string) => `${b}+`);
    const r = await runFixLoop({ evaluate, revise, body: "v0", maxRounds: 3 });
    expect(r.body).toBe("v0+");
    expect(r.best.overall).toBe(0.7);
  });

  it("stops early when a round scores worse than the one before", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(verdict(0.6))
      .mockResolvedValueOnce(verdict(0.4));
    const revise = vi.fn(async (_v, b: string) => `${b}+`);
    const r = await runFixLoop({ evaluate, revise, body: "v0", maxRounds: 3 });
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(r.body).toBe("v0");
  });

  // Not vacuous: a first-round pass must ship a REAL verdict as `best`, not a
  // stand-in that would let a caller mistake "never evaluated" for "passed".
  it("reports a real verdict as best when the first round already passes", async () => {
    const evaluate = vi.fn().mockResolvedValue(verdict(0.95));
    const revise = vi.fn();
    const r = await runFixLoop({ evaluate, revise, body: "original" });
    expect(r.best).toEqual(verdict(0.95));
    expect(r.history).toEqual([verdict(0.95)]);
  });

  // A cap below 1 would let the loop return without ever calling `evaluate` —
  // `best` would have nothing real to report. That is a caller error, not a
  // silent vacuous pass, so it must fail loudly instead of returning a
  // fabricated or null verdict.
  it("rejects a cap that would produce zero rounds", async () => {
    const evaluate = vi.fn();
    const revise = vi.fn();
    await expect(runFixLoop({ evaluate, revise, body: "x", maxRounds: 0 })).rejects.toThrow(
      /maxRounds/,
    );
    expect(evaluate).not.toHaveBeenCalled();
  });
});
