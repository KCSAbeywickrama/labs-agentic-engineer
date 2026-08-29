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

import type { Scenario } from "./scenario.js";

type Brief = Scenario["brief"];

/** The value of a fact the brief holds back until asked for by name. */
export function withheldValue(brief: Brief, name: string): string | undefined {
  if (!brief.withholds.includes(name)) return undefined;
  const v = brief.facts[name];
  return v === undefined ? undefined : String(v);
}

// Strips every withheld fact's value out of free text. `goal` is
// author-written prose and may state a withheld fact in passing (a traveller
// naturally says their dates up front) — returning it verbatim would leak the
// fact turn 0 was supposed to hold back, silently defeating `withholds`.
function redactWithheld(text: string, brief: Brief): string {
  let out = text;
  for (const name of brief.withholds) {
    const v = withheldValue(brief, name);
    if (v && out.includes(v)) out = out.split(v).join("[withheld]");
  }
  return out;
}

/**
 * What the simulated user says next.
 *
 * Deliberately RULE-BASED, not a model: the sim is part of the measuring
 * instrument, so it must behave identically between two runs of the same
 * scenario. A model here would make a score change unattributable — you could
 * not tell a better prompt from a chattier user.
 */
export function simAnswer(brief: Brief, agentSaid: string, turn: number): string {
  if (turn === 0) {
    // Open with the goal plus whatever facts weren't withheld — this is the
    // only way `withholds` has anything to do: without it, "does the agent
    // ask for what it needs?" is unobservable, since the user would have
    // said everything already.
    const volunteered = Object.entries(brief.facts).filter(([name]) => !brief.withholds.includes(name));
    const extra = volunteered.length
      ? ` (${volunteered.map(([name, value]) => `${name}: ${String(value)}`).join(", ")})`
      : "";
    return redactWithheld(brief.goal, brief) + extra;
  }

  const asked = agentSaid.toLowerCase();
  for (const [name, value] of Object.entries(brief.facts)) {
    // A fact is offered when the agent's turn mentions it by name. Withheld
    // facts take the same path — withholding is about not VOLUNTEERING, not
    // about refusing to answer.
    if (asked.includes(name.toLowerCase())) return String(value);
  }
  // Nothing recognisable was asked, so there is nothing to add. Closing keeps
  // a scenario bounded rather than looping on the org's key.
  return "That's all, thanks.";
}
