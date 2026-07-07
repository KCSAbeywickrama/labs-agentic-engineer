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
 * ×K it materializes the read-only context (spec/design [+ existing Tasks]) and
 * the repo skill library into a fixture workspace mount, boots the real Express
 * app over it, POSTs a `toolset: "task-plan"` workspace turn, consumes the SSE
 * stream, distills it into a `PlanTrace`, and scores skill pickup + plan
 * quality. Report-not-gate.
 *
 * The plumbing — `boot`, `collectTurn`, the result shapes, and the K-sampling
 * drivers (`sampleFixture`/`sampleSuite`) — is the file harness's, imported from
 * `../harness.js`; only the per-sample scoring differs here.
 */

import type { LanguageModel } from "ai";
import { type TurnRequest } from "@aep/agent-stream";
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
import { EvalWorkspace, EVAL_ORG, evalConversationId } from "../workspace.js";
import { allPass } from "../scoring.js";
import type { RepoSkill } from "../skills.js";
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
  /** Repo-root `skills/` — materialized whole into the fixture `_skills` snapshot, incl. task-planning. */
  skillsDir?: string;
}

export interface RunOptions {
  model: LanguageModel;
  samples: number;
  apiKey?: string;
  skills?: RepoSkill[];
  onLog?: (msg: string) => void;
}

async function runSample(suite: TaskPlanSuite, fixture: TaskPlanFixture, opts: RunOptions): Promise<SampleResult> {
  const seed = fixture.seed ?? suite.defaultSeed;
  const ws = new EvalWorkspace();
  const { baseUrl, close } = await boot(opts.model, ws.root);
  try {
    const id = evalConversationId(fixture.name);
    const headers = await evalTurnHeaders(opts.apiKey ?? "eval", EVAL_ORG);
    const turns: TurnResult[] = [];
    for (let i = 0; i < fixture.turns.length; i++) {
      const turn = fixture.turns[i]!;
      // The plan context is read-only, so every turn references the same seed snapshot.
      const body: TurnRequest = {
        instruction: turn.prompt,
        workspace: ws.workspaceRef(id, i, seed, opts.skills ?? []),
        toolset: "task-plan",
      };
      const parts = await collectTurn(baseUrl, id, body, headers);

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
    ws.cleanup();
  }
}

export async function runFixture(suite: TaskPlanSuite, fixture: TaskPlanFixture, opts: RunOptions): Promise<FixtureResult> {
  return sampleFixture(fixture, opts, (f) => runSample(suite, f, opts));
}

export async function runSuite(suite: TaskPlanSuite, fixtures: TaskPlanFixture[], opts: RunOptions): Promise<SuiteResult> {
  return sampleSuite(suite.agent, fixtures, opts, (f) => runSample(suite, f, opts));
}
