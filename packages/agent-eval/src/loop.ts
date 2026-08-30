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

import type { Verdict } from "./verdict.js";

export interface LoopResult {
  body: string;
  rounds: number;
  best: Verdict;
  history: Verdict[];
}

const DEFAULT_MAX_ROUNDS = 3;

/**
 * Evaluate, revise, repeat — within bounds that exist because the system is
 * probabilistic and the model calls are on the org's key.
 *
 * Three rules, each earning its place:
 *  - a CAP, because "iterate until it passes" may never converge;
 *  - keep the BEST-scoring body, because a revision can make the agent worse
 *    and the last attempt is not automatically the right one to ship;
 *  - stop early when a round regresses, because a loop that has started going
 *    backwards has no reason to find its way forward by spending more.
 */
export async function runFixLoop(opts: {
  evaluate: () => Promise<Verdict>;
  revise: (verdict: Verdict, body: string) => Promise<string>;
  body: string;
  maxRounds?: number;
}): Promise<LoopResult> {
  const max = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  // A cap under 1 would mean the loop returns without ever calling
  // `evaluate` — there would be no real verdict to report as `best`, only a
  // fabricated stand-in or a lie about having passed. That is a caller
  // error, and it must fail loudly rather than produce a vacuous result.
  if (max < 1) throw new Error(`runFixLoop: maxRounds must be at least 1, got ${max}`);

  const history: Verdict[] = [];
  let body = opts.body;
  let bestBody = opts.body;
  let best: Verdict | null = null;

  for (let round = 1; round <= max; round++) {
    const verdict = await opts.evaluate();
    history.push(verdict);

    if (best === null || verdict.overall > best.overall) {
      best = verdict;
      bestBody = body;
    } else if (verdict.overall < history[history.length - 2]!.overall) {
      // Regressed: keep what was better and stop.
      break;
    }

    if (verdict.passed || round === max) break;
    body = await opts.revise(verdict, body);
  }

  return { body: bestBody, rounds: history.length, best: best!, history };
}
