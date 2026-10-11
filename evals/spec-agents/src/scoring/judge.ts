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
 * The rubric judge (#355): one call per section artifact. Sees the artifact,
 * the rubric, the sim user's decisions digest (#354) and the organization's
 * settled defaults — user-decided scope and an org default the agent followed
 * are never penalized as invention. The weighted score is computed HERE from
 * the judge's per-item booleans, not by the model.
 */

import { existsSync, readFileSync } from "node:fs";
import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { ensureAnthropicKey, JUDGE_MODEL, ORG_SKILL_PATH } from "../config.js";
import type { Rubric } from "../scenario.js";

export interface JudgedItem {
  item: string;
  weight: number;
  covered: boolean;
  evidence: string;
}

export interface JudgeReport {
  /** Weighted mustCover coverage, 0..1. */
  weightedScore: number;
  items: JudgedItem[];
  /** Declared anti-requirements the artifact violates (forces ≥ review). */
  mustNotViolations: Array<{ item: string; evidence: string }>;
  /** Substantive scope not traceable to rubric, brief, or user decisions — reported, not scored. */
  inventions: string[];
}

/**
 * The organization skill's settled sections: its body from the first `## `
 * heading on (the frontmatter and the how-to-use preamble are for the agent).
 * Undefined when the skill is absent or settles nothing.
 */
export function orgDefaults(path: string = ORG_SKILL_PATH): string | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const start = text.search(/^## /m);
  return start < 0 ? undefined : text.slice(start).trim();
}

export async function judgeArtifact(input: {
  rubric: Rubric;
  artifactLabel: string;
  artifact: string;
  decisionsDigest?: string;
  /**
   * The organization skill's settled sections (`orgDefaults()`). The agent
   * answers a settled policy from it instead of asking, so a judge that never
   * saw it scores that decision as missing or invented.
   */
  orgDefaults?: string;
}): Promise<JudgeReport> {
  const anthropic = createAnthropic({ apiKey: ensureAnthropicKey() });
  const mustCover = input.rubric.mustCover;

  // Structured output (schema-validated, provider-repaired) — a raw-JSON
  // judge reply breaks the moment an evidence quote contains a quote mark.
  const responseSchema = z.object({
    items: z.array(z.object({ index: z.number(), covered: z.boolean(), evidence: z.string() })),
    mustNot: z.array(z.object({ index: z.number(), violated: z.boolean(), evidence: z.string() })).default([]),
    inventions: z.array(z.string()).default([]),
  });

  const { object: parsed } = await generateObject({
    model: anthropic(JUDGE_MODEL),
    schema: responseSchema,
    system: `You judge a generated ${input.artifactLabel} against a rubric.

For each MUST-COVER item (by index) decide covered=true/false — covered means the artifact states it, correctly and unambiguously. Quote the evidence (or say why it is missing/wrong).
For each MUST-NOT item (by index) decide violated=true/false — violated means the artifact contains what the item forbids. Quote the evidence when violated.
Also list INVENTIONS: substantive requirements or scope in the artifact that trace to neither the rubric, nor plausibly to the product idea, nor to the user's interview decisions given below, nor to the organization's settled defaults given below. Do not list phrasing differences or reasonable elaborations.
An organization default is settled before the run: an artifact that follows one complies with it. Where a rubric item names a choice an organization default makes (a sign-in provider, a stack), the default satisfies it unless the item says otherwise.`,
    prompt: [
      `MUST COVER:\n${mustCover.map((m, i) => `${i}. ${m.item}`).join("\n")}`,
      input.rubric.mustNot.length ? `MUST NOT:\n${input.rubric.mustNot.map((m, i) => `${i}. ${m}`).join("\n")}` : "",
      input.decisionsDigest ? `USER INTERVIEW DECISIONS (user-approved scope, NOT inventions):\n${input.decisionsDigest}` : "",
      input.orgDefaults ? `ORGANIZATION DEFAULTS (settled by the organization, NOT inventions):\n${input.orgDefaults}` : "",
      `ARTIFACT (${input.artifactLabel}):\n${input.artifact}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const items: JudgedItem[] = mustCover.map((m, i) => {
    const j = parsed.items.find((x) => x.index === i) ?? parsed.items[i];
    return { item: m.item, weight: m.weight, covered: j?.covered === true, evidence: j?.evidence ?? "(no judgment returned)" };
  });

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const coveredWeight = items.reduce((s, i) => s + (i.covered ? i.weight : 0), 0);

  const mustNotViolations = input.rubric.mustNot
    .map((item, i) => ({ item, j: parsed.mustNot.find((x) => x.index === i) ?? parsed.mustNot[i] }))
    .filter(({ j }) => j?.violated === true)
    .map(({ item, j }) => ({ item, evidence: j?.evidence ?? "" }));

  return {
    weightedScore: totalWeight > 0 ? coveredWeight / totalWeight : 0,
    items,
    mustNotViolations,
    inventions: parsed.inventions,
  };
}
