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
 * The LLM-simulated user (map decision #354). Answers the agent's structured
 * questions strictly from a scenario brief. Never sees the rubric. Three
 * behaviors are load-bearing for scoring:
 *
 *  - ADJACENT-ONLY volunteering: an unasked fact may ride an answer whose
 *    question touches its area — and is TAGGED, so coverage stays attributable.
 *  - SOURCE tracking per answer (fact | persona-fallback | improvised);
 *    improvisations reach the judge as "user-decided", not doc inventions.
 *  - FATIGUE: cumulative question count degrades answers (engaged → terse →
 *    defers), so an over-asking agent pays through interview yield. The
 *    counter resets per section (#357).
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AskQuestionInput } from "@aep/agent-stream";
import { ensureAnthropicKey, SIM_MODEL } from "./config.js";
import type { ScenarioBrief } from "./scenario.js";

export type AnswerSource = "fact" | "persona-fallback" | "improvised";

export interface SimAnswer {
  question: string;
  selected: string[];
  freeText?: string;
  source: AnswerSource;
  /** Brief facts volunteered on this answer without being asked (verbatim). */
  volunteered: string[];
}

export type FatigueTier = "fresh" | "tiring" | "tired";

/** #354: engaged through ~6 questions, terse to ~11, deferring from 12 on. */
export function fatigueTier(questionsAskedBefore: number): FatigueTier {
  if (questionsAskedBefore < 7) return "fresh";
  if (questionsAskedBefore < 12) return "tiring";
  return "tired";
}

const FATIGUE_DIRECTIVE: Record<FatigueTier, string> = {
  fresh:
    "You are fresh and engaged: answer thoughtfully, add a short clarifying note where a fact adds nuance, and you MAY volunteer one adjacent fact.",
  tiring:
    "You are getting tired of questions: answer briefly — option labels with at most a few words of note, volunteer nothing unless it prevents a clear mistake.",
  tired:
    "You are tired of this interview: keep it short, prefer the recommended or simplest option, feel free to answer 'keep it simple — you decide' via freeText, and volunteer nothing.",
};

const RESPONSE_SHAPE = `Respond with STRICT JSON — an array, one element per question, in order:
[{"question": "<the question verbatim>",
  "selected": ["<option label exactly as written>"],
  "freeText": "<optional short note>",
  "source": "fact" | "persona-fallback" | "improvised",
  "volunteered": ["<brief fact you added without being asked, verbatim from your facts>"]}]
"source" is where your answer came from: "fact" when your facts settle it, "persona-fallback" when your standing preference decided, "improvised" when you had to make a new decision beyond the brief.
"volunteered" lists ONLY facts from your fact list that the question did not ask about but you chose to mention because the question touches their area; empty array otherwise.
No prose, no markdown fences.`;

/**
 * Answer one batch of interview questions. `questionsAskedBefore` is the
 * cumulative count already asked THIS SECTION (fatigue input).
 */
export async function simAnswers(
  brief: ScenarioBrief,
  questions: AskQuestionInput[],
  questionsAskedBefore: number,
): Promise<SimAnswer[]> {
  const tier = fatigueTier(questionsAskedBefore);
  const anthropic = createAnthropic({ apiKey: ensureAnthropicKey() });

  const qBlock = questions
    .map((q, i) => {
      const opts = q.options
        .map((o) => `  - ${o.label}${o.description ? ` (${o.description})` : ""}`)
        .join("\n");
      return `Q${i + 1}: ${q.question}\n${q.detail ? `Context: ${q.detail}\n` : ""}${q.multiSelect ? "(multiple selections allowed)" : "(pick one)"}\nOptions:\n${opts}`;
    })
    .join("\n\n");

  const { text } = await generateText({
    model: anthropic(SIM_MODEL),
    system: `You are role-playing a product owner in a spec interview. Stay in character.

Your persona: ${brief.persona}
${brief.traits?.length ? `Your behavior: ${brief.traits.join("; ")}\n` : ""}Your product idea: ${brief.idea}
Facts you know (answer from these when relevant):
${brief.facts.map((f) => `- ${f}`).join("\n")}

For anything the facts do not settle: ${brief.fallback}

Interview state: ${questionsAskedBefore} questions have already been asked. ${FATIGUE_DIRECTIVE[tier]}

Rules:
- Answer ONLY from the persona/facts above; beyond them, decide per your standing preference and mark the answer "improvised".
- Volunteering is allowed ONLY when a question touches a fact's area — never dump unrelated facts.
- Pick option labels EXACTLY as written. Use freeText when the options genuinely miss your answer or a fact adds needed nuance.

${RESPONSE_SHAPE}`,
    prompt: qBlock,
  });

  return salvage(questions, text);
}

/** Validate the sim's JSON against the actual questions; salvage bad picks. */
export function salvage(questions: AskQuestionInput[], rawText: string): SimAnswer[] {
  const cleaned = rawText.trim().replace(/^```(json)?|```$/g, "");
  let parsed: Array<Partial<SimAnswer>>;
  try {
    parsed = JSON.parse(cleaned) as Array<Partial<SimAnswer>>;
  } catch {
    parsed = [];
  }
  return questions.map((q, i) => {
    const a = parsed[i] ?? {};
    const valid = new Set(q.options.map((o) => o.label));
    const selected = (a.selected ?? []).filter((l) => valid.has(l));
    const dropped = (a.selected ?? []).filter((l) => !valid.has(l));
    const freeText = [a.freeText, ...dropped].filter(Boolean).join("; ");
    const source: AnswerSource =
      a.source === "fact" || a.source === "persona-fallback" || a.source === "improvised"
        ? a.source
        : "persona-fallback";
    return {
      question: q.question,
      selected,
      ...(freeText ? { freeText } : {}),
      source,
      volunteered: a.volunteered ?? [],
    };
  });
}

/**
 * The judge's context (#355): what the "user" decided beyond the brief and
 * what they volunteered — so neither is penalized as a document invention.
 */
export function decisionsDigest(answers: SimAnswer[]): string {
  const improvised = answers.filter((a) => a.source === "improvised");
  const volunteered = answers.flatMap((a) => a.volunteered);
  if (improvised.length === 0 && volunteered.length === 0) return "";
  const lines: string[] = [];
  if (improvised.length) {
    lines.push("Decisions the user made during the interview (NOT in the original brief — treat as user-approved scope):");
    for (const a of improvised) {
      lines.push(`- Asked "${a.question}" → ${a.selected.join(", ")}${a.freeText ? ` — ${a.freeText}` : ""}`);
    }
  }
  if (volunteered.length) {
    lines.push("Facts the user volunteered during the interview:");
    for (const v of volunteered) lines.push(`- ${v}`);
  }
  return lines.join("\n");
}
