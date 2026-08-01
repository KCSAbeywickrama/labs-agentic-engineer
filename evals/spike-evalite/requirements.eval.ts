/**
 * SPIKE (wayfinder ticket #353): can evalite host a multi-turn eval of the
 * requirements section, driving the REAL agents service in-process through the
 * playground's production-parity waist (openSession + chatTurn), with an
 * LLM-simulated user answering the /start interview?
 */
import { evalite, createScorer } from "evalite";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { simAnswers, type ScenarioBrief } from "./sim-user.js";

const REPO = "/home/jo/workspace/labs-agentic-engineer";

// Source ANTHROPIC_API_KEY from deployments/.env for the sim + judge (the
// playground session loads it for the agent itself).
if (!process.env.ANTHROPIC_API_KEY) {
  const env = readFileSync(join(REPO, "deployments/.env"), "utf8");
  const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m?.[1]) process.env.ANTHROPIC_API_KEY = m[1].trim();
}

// Production-parity driver waist (imported straight from the repo's TS source).
import { openSession } from "/home/jo/workspace/labs-agentic-engineer/playground/src/engine/session.js";
import { chatTurn } from "/home/jo/workspace/labs-agentic-engineer/playground/src/commands.js";
import { startInstruction } from "/home/jo/workspace/labs-agentic-engineer/playground/src/engine/compose.js";
import {
  buildAnswerInstruction,
  buildAnswersInstruction,
} from "/home/jo/workspace/labs-agentic-engineer/packages/agent-stream/src/index.js";

const PROJECTS = join(import.meta.dirname, "projects");
const MAX_TURNS = 8;

interface RunOutput {
  requirementsMd: string;
  turns: number;
  questionsAsked: number;
  finishedInterview: boolean;
  transcript: string[];
}

const scenario: { brief: ScenarioBrief; rubric: string[] } = {
  brief: {
    name: "lunch-coordinator",
    idea: "A web app for coordinating team lunch orders: someone opens a daily order, teammates add items from a chosen restaurant before a cutoff, and the opener gets one consolidated order to place.",
    persona:
      "Engineering manager at a 40-person startup; pragmatic, wants a small v1 shipped fast; non-technical answers, plain language.",
    facts: [
      "Users sign in with their existing Google workspace accounts; no separate registration.",
      "One order round per day is enough; the opener picks the restaurant and the cutoff time.",
      "Teammates only add/edit/remove their own items before the cutoff; after cutoff the round locks.",
      "The opener needs a consolidated view grouped by menu item, plus per-person cost totals.",
      "Payment stays offline (people pay the opener back directly); the app only tracks who owes what.",
      "Notifications: a message to the team's existing Slack channel when a round opens and at cutoff is enough; no email.",
      "Mobile browser support matters; a native app does not.",
    ],
    fallback:
      "Prefer the smallest reasonable v1; defer anything speculative; pick the recommended option when genuinely indifferent.",
  },
  rubric: [
    "Google-workspace sign-in captured; no separate registration flow invented",
    "Daily order round lifecycle: open (restaurant + cutoff) -> teammates add own items -> lock at cutoff",
    "Consolidated order view grouped by item with per-person cost totals",
    "Payment explicitly out of scope beyond tracking who owes what",
    "Slack notifications at round open and cutoff; no email flows invented",
    "Mobile-browser support noted; no native app scope invented",
  ],
};

async function runRequirementsSection(brief: ScenarioBrief): Promise<RunOutput> {
  const projectDir = join(PROJECTS, brief.name);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });

  const session = await openSession(projectDir, {});
  const transcript: string[] = [];
  let questionsAsked = 0;
  let turns = 0;
  let finishedInterview = false;

  try {
    let text = startInstruction(brief.idea);
    while (turns < MAX_TURNS) {
      turns++;
      transcript.push(`>> turn ${turns}: ${text.slice(0, 160)}`);
      const outcome = await chatTurn(session, text, { silent: true });
      if (!outcome.ok) {
        transcript.push(`!! turn failed: ${outcome.detail}`);
        break;
      }
      if (!outcome.pending) {
        finishedInterview = true;
        break;
      }
      questionsAsked += outcome.pending.questions.length;
      transcript.push(
        ...outcome.pending.questions.map((q) => `?? ${q.question}`),
      );
      const answers = await simAnswers(brief, outcome.pending.questions);
      transcript.push(
        ...answers.map((a) => `-- ${a.selected.join(", ")}${a.freeText ? ` — ${a.freeText}` : ""}`),
      );
      text = outcome.pending.batch
        ? buildAnswersInstruction(answers)
        : buildAnswerInstruction(
            answers[0]!.question,
            answers[0]!.selected,
            answers[0]!.freeText,
          );
    }
  } finally {
    await session.close();
  }

  const reqPath = join(projectDir, "specs/requirements/requirements.md");
  const requirementsMd = existsSync(reqPath) ? readFileSync(reqPath, "utf8") : "";
  return { requirementsMd, turns, questionsAsked, finishedInterview, transcript };
}

/** Deterministic structural check: the artifact exists and looks like a spec. */
const artifactCheck = createScorer<ScenarioBrief, RunOutput>({
  name: "requirements-artifact",
  scorer: ({ output }) => {
    const md = output.requirementsMd;
    const headings = (md.match(/^#{1,3} /gm) ?? []).length;
    const checks = {
      exists: md.length > 0,
      substantial: md.length >= 800,
      structured: headings >= 3,
      interviewHappened: output.questionsAsked > 0,
      interviewFinished: output.finishedInterview,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return { score: passed / Object.keys(checks).length, metadata: checks };
  },
});

/** LLM judge: rubric coverage + faithfulness to the brief. */
const rubricJudge = createScorer<ScenarioBrief, RunOutput>({
  name: "rubric-judge",
  scorer: async ({ output }) => {
    if (!output.requirementsMd) return { score: 0, metadata: { reason: "no artifact" } };
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { text } = await generateText({
      model: anthropic("claude-sonnet-5"),
      system: `You judge a generated requirements document against a rubric. For each rubric item decide covered=true/false (covered means the document states it, correctly). Also list inventions: substantive requirements in the document that contradict the rubric's spirit. Respond with STRICT JSON: {"items": [{"item": "...", "covered": true, "evidence": "<quote or why not>"}], "inventions": ["..."]}. No markdown fences.`,
      prompt: `RUBRIC:\n${scenario.rubric.map((r) => `- ${r}`).join("\n")}\n\nDOCUMENT:\n${output.requirementsMd}`,
    });
    const parsed = JSON.parse(text.trim().replace(/^```(json)?|```$/g, "")) as {
      items: Array<{ item: string; covered: boolean; evidence: string }>;
      inventions: string[];
    };
    const covered = parsed.items.filter((i) => i.covered).length;
    const score = Math.max(
      0,
      covered / scenario.rubric.length - 0.1 * parsed.inventions.length,
    );
    return { score, metadata: parsed };
  },
});

evalite<ScenarioBrief, RunOutput>("requirements-section", {
  data: () => [{ input: scenario.brief }],
  task: (brief) => runRequirementsSection(brief),
  scorers: [artifactCheck, rubricJudge],
  columns: ({ output }) => [
    { label: "turns", value: output.turns },
    { label: "questions", value: output.questionsAsked },
    { label: "finished", value: output.finishedInterview },
    { label: "req.md chars", value: output.requirementsMd.length },
  ],
});
