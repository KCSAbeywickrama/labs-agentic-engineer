/**
 * The LLM-simulated user: answers the agent's ask_question/ask_questions
 * tool-calls strictly from a scenario brief. Plays the product owner; never
 * invents requirements beyond the brief, never sees the rubric.
 */
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

export interface ScenarioBrief {
  name: string;
  idea: string;
  persona: string;
  /** Facts the sim may reveal when asked (the "hidden" spec). */
  facts: string[];
  /** Standing preferences for questions the facts don't settle. */
  fallback: string;
}

export interface SimQuestion {
  question: string;
  detail?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export interface SimAnswer {
  question: string;
  selected: string[];
  freeText?: string;
}

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function simAnswers(
  brief: ScenarioBrief,
  questions: SimQuestion[],
): Promise<SimAnswer[]> {
  const qBlock = questions
    .map((q, i) => {
      const opts = q.options
        .map((o) => `  - ${o.label}${o.description ? ` (${o.description})` : ""}`)
        .join("\n");
      return `Q${i + 1}: ${q.question}\n${q.detail ? `Context: ${q.detail}\n` : ""}${q.multiSelect ? "(multiple selections allowed)" : "(pick one)"}\nOptions:\n${opts}`;
    })
    .join("\n\n");

  const { text } = await generateText({
    model: anthropic("claude-sonnet-5"),
    system: `You are role-playing a product owner in a requirements interview. Stay in character.

Your persona: ${brief.persona}
Your product idea: ${brief.idea}
Facts you know (answer from these when relevant):
${brief.facts.map((f) => `- ${f}`).join("\n")}

For anything the facts do not settle: ${brief.fallback}

Rules:
- Answer ONLY from the persona/facts above. Do not invent new scope.
- For each question pick option label(s) EXACTLY as written. Add a short freeText note only when the options genuinely miss your answer or a fact adds needed nuance.
- Respond with STRICT JSON: an array, one element per question, shape {"question": "<the question verbatim>", "selected": ["<label>"], "freeText": "<optional>"}. No prose, no markdown fences.`,
    prompt: qBlock,
  });

  const cleaned = text.trim().replace(/^```(json)?|```$/g, "");
  const parsed = JSON.parse(cleaned) as SimAnswer[];

  // Guard: keep only labels that actually exist; salvage bad picks as freeText.
  return questions.map((q, i) => {
    const a = parsed[i] ?? { question: q.question, selected: [] };
    const valid = new Set(q.options.map((o) => o.label));
    const selected = (a.selected ?? []).filter((l) => valid.has(l));
    const dropped = (a.selected ?? []).filter((l) => !valid.has(l));
    const freeText = [a.freeText, ...dropped].filter(Boolean).join("; ") || undefined;
    return { question: q.question, selected, ...(freeText ? { freeText } : {}) };
  });
}
