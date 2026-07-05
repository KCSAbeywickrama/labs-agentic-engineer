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

/**
 * The plan-turn eval harness — the file harness's sibling. Per fixture, per turn,
 * ×K it boots the real Express app, POSTs a `toolset: "task-plan"` turn with the
 * read-only context (spec/design [+ existing Tasks]) as `files` and the repo skill
 * library pushed, consumes the SSE stream, distills it into a `PlanTrace`, and
 * scores skill pickup + plan quality. Report-not-gate.
 *
 * The plumbing — `boot`, `collectTurn`, the result shapes, and the K-sampling
 * drivers (`sampleFixture`/`sampleSuite`) — is the file harness's, imported from
 * `../harness.js`; only the per-sample scoring differs here.
 */

import type { LanguageModel } from "ai";
import { type Skill, type TurnRequest } from "@aep/agent-stream";
import {
  boot,
  collectTurn,
  sampleFixture,
  sampleSuite,
  type FixtureResult,
  type SampleResult,
  type SuiteResult,
  type TurnResult,
} from "../harness.js";
import { evalTurnHeaders } from "../auth.js";
import { allPass } from "../scoring.js";
import { scoreTaskPlan, traceOfTurn, type TaskPlanExpect } from "./scoring.js";

export interface TaskPlanTurn {
  prompt: string;
  expect: TaskPlanExpect;
}

export interface TaskPlanFixture {
  name: string;
  description?: string;
  difficulty?: string;
  /** The read-only plan context (spec/design [+ tasks/]); falls back to the suite default. */
  seed?: Record<string, string>;
  turns: TaskPlanTurn[];
}

export interface TaskPlanSuite {
  agent: string;
  defaultSeed: Record<string, string>;
  /** Repo-root `skills/` — pushed whole on every turn (ADR-0002), incl. task-planning. */
  skillsDir?: string;
}

export interface RunOptions {
  model: LanguageModel;
  samples: number;
  apiKey?: string;
  skills?: Skill[];
  onLog?: (msg: string) => void;
}

function turnBody(prompt: string, files: Record<string, string>, skills?: Skill[]): TurnRequest {
  return {
    instruction: prompt,
    files,
    toolset: "task-plan",
    ...(skills && skills.length > 0 ? { skills } : {}),
  };
}

async function runSample(suite: TaskPlanSuite, fixture: TaskPlanFixture, opts: RunOptions): Promise<SampleResult> {
  const seed = fixture.seed ?? suite.defaultSeed;
  const { baseUrl, close } = await boot(opts.model);
  try {
    const id = fixture.name;
    const headers = await evalTurnHeaders(opts.apiKey ?? "eval");
    const turns: TurnResult[] = [];
    for (let i = 0; i < fixture.turns.length; i++) {
      const turn = fixture.turns[i]!;
      const parts = await collectTurn(baseUrl, id, turnBody(turn.prompt, seed, opts.skills), headers);

      const checks = scoreTaskPlan(turn.expect, traceOfTurn(parts));
      // A mid-stream error frame yields no scoreable result — fail explicitly so a
      // stream error can't report a false green (mirrors the file harness).
      const errorFrames = parts.filter((p) => p.type === "tool-error" || p.type === "error");
      if (errorFrames.length > 0) {
        checks.push({ clause: "noStreamErrors", pass: false, detail: `${errorFrames.length} error frame(s)` });
      }
      turns.push({ turn: i + 1, prompt: turn.prompt, pass: allPass(checks), checks });
    }
    return { pass: turns.every((t) => t.pass), turns };
  } finally {
    await close();
  }
}

export async function runFixture(suite: TaskPlanSuite, fixture: TaskPlanFixture, opts: RunOptions): Promise<FixtureResult> {
  return sampleFixture(fixture, opts, (f) => runSample(suite, f, opts));
}

export async function runSuite(suite: TaskPlanSuite, fixtures: TaskPlanFixture[], opts: RunOptions): Promise<SuiteResult> {
  return sampleSuite(suite.agent, fixtures, opts, (f) => runSample(suite, f, opts));
}
