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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AgentEvalProvider from "../src/provider.js";
import { parseScenarios } from "../src/scenario.js";
import { writeFakeAgent } from "./fake-agent.js";

let dir: string;

const SCENARIO = parseScenarios({
  version: 1,
  component: "lunch-buddy",
  scenarios: [
    {
      id: "SC-001",
      brief: { goal: "Order lunch.", facts: { budget: "20" }, withholds: ["budget"] },
      rubric: { mustCover: [{ id: "MC-1", must: "asks for the budget", weight: 1 }], mustNot: [] },
    },
  ],
}).scenarios[0]!;

const OPENAPI = `openapi: 3.0.3
info: { title: lunch-api, version: "1.0.0" }
paths:
  /rounds:
    get:
      operationId: listRounds
      responses:
        "200": { content: { application/json: { example: [{ id: "r-1" }] } } }
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-eval-provider-"));
  writeFakeAgent(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function provider(config: Record<string, unknown>): AgentEvalProvider {
  return new AgentEvalProvider({ config: { readyTimeoutMs: 20_000, ...config } });
}

describe("AgentEvalProvider", () => {
  // The bug this task exists to fix: `vars` is JSON, so the config file
  // could never carry an `ask`, and the provider threw on every scenario.
  it("builds its own ask from config and returns a real transcript", async () => {
    const result = await provider({ appDir: dir, maxTurns: 2 }).callApi("", {
      vars: { scenario: SCENARIO },
    });
    expect(result.output).toContain("User: Order lunch.");
    expect(result.output).toContain("Agent: turn 1 of");
    expect(result.metadata.scenarioId).toBe("SC-001");
  }, 20_000);

  // The same agent process serves every turn of a scenario, and the
  // conversation id threads through — "a second turn must remember".
  it("keeps one conversation for the whole scenario", async () => {
    const result = await provider({ appDir: dir, maxTurns: 2 }).callApi("", {
      vars: { scenario: SCENARIO },
    });
    expect(result.output).toContain("turn 2 of");
    expect(result.output).toContain("first: Order lunch.");
  }, 20_000);

  it("starts a fresh conversation for the next scenario", async () => {
    const p = provider({ appDir: dir, maxTurns: 1 });
    const first = await p.callApi("", { vars: { scenario: SCENARIO } });
    const second = await p.callApi("", { vars: { scenario: SCENARIO } });
    expect(second.output).toContain("turn 1 of");
    expect(idOf(second.output)).not.toBe(idOf(first.output));
  }, 30_000);

  // The Task 4 seam: an injected `ask` still wins, so the conversation-level
  // tests need neither a child process nor a key.
  it("honours an injected ask, and boots nothing when one is given", async () => {
    const seen: string[] = [];
    const result = await provider({ maxTurns: 1 }).callApi("", {
      vars: {
        scenario: SCENARIO,
        ask: async (messages) => {
          seen.push(messages[messages.length - 1]!.content);
          return "what is your budget?";
        },
      },
    });
    expect(seen).toEqual(["Order lunch."]);
    expect(result.output).toContain("Agent: what is your budget?");
  });

  it("refuses to run with neither an appDir nor an injected ask", async () => {
    await expect(provider({}).callApi("", { vars: { scenario: SCENARIO } })).rejects.toThrow(
      /appDir/,
    );
  });

  // An agent that never came up must surface AS a failure. Returning an
  // empty transcript here would hand the grader a blank conversation and
  // score a harness problem as bad agent behaviour.
  it("raises rather than returning an empty transcript when the agent cannot boot", async () => {
    const empty = mkdtempSync(join(tmpdir(), "agent-eval-nobuild-"));
    try {
      await expect(
        provider({ appDir: empty, maxTurns: 1 }).callApi("", { vars: { scenario: SCENARIO } }),
      ).rejects.toThrow(/never became ready/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 20_000);

  // A leaked agent per scenario would pile up across a three-round loop,
  // each one holding a port and the org's model credential.
  it("closes the agent when the scenario is over", async () => {
    const result = await provider({ appDir: dir, maxTurns: 1 }).callApi("", {
      vars: { scenario: SCENARIO },
    });
    const port = /; port: (\d+);/.exec(result.output)![1]!;
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  }, 20_000);

  // End to end through the provider: the stub URL reaches the agent, the
  // agent calls it, and what comes back is the contract's OWN example — the
  // deterministic world a comparable score depends on.
  it("points the agent's declared tool address at a stub of the committed contract", async () => {
    const specPath = join(dir, "openapi.yaml");
    writeFileSync(specPath, OPENAPI);
    const result = await provider({
      appDir: dir,
      maxTurns: 1,
      toolStubs: [{ envVar: "LUNCH_API_URL", specPath }],
    }).callApi("", { vars: { scenario: SCENARIO } });
    expect(result.output).toContain('tool: [{"id":"r-1"}]');
  }, 20_000);
});

function idOf(transcript: string): string {
  return /turn \d+ of ([^;]+);/.exec(transcript)![1]!;
}
