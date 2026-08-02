/**
 * SPIKE (wayfinder ticket #353): evalite hosting a multi-turn eval of the
 * requirements section. DATA-DRIVEN: each `scenarios/*.yaml` file is one eval
 * case — `brief` (the sim-user prompt side) + `rubric` (the evaluation side).
 * Full agent communication is captured per run: evalite traces (serve UI),
 * `<name>.transcript.md` (readable), `<name>.trace.json` (raw stream).
 */
import { evalite, createScorer } from "evalite";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { runRequirementsSection, type RunOutput } from "./driver.js";
import type { ScenarioBrief } from "./sim-user.js";

const REPO = "/home/jo/workspace/labs-agentic-engineer";

// The one sanctioned in-repo home for playground projects (gitignored;
// see playground/src/paths.ts projectDirError).
const PROJECTS = join(REPO, "playground/.projects/evalite-spike");

// Source ANTHROPIC_API_KEY from deployments/.env for the sim + judge (the
// playground session loads it for the agent itself).
if (!process.env.ANTHROPIC_API_KEY) {
  const env = readFileSync(join(REPO, "deployments/.env"), "utf8");
  const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m?.[1]) process.env.ANTHROPIC_API_KEY = m[1].trim();
}

interface Scenario {
  brief: ScenarioBrief;
  rubric: string[];
}

const SCENARIOS_DIR = join(import.meta.dirname, "scenarios");
const scenarios: Scenario[] = readdirSync(SCENARIOS_DIR)
  .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
  .map((f) => parseYaml(readFileSync(join(SCENARIOS_DIR, f), "utf8")) as Scenario);

/** Deterministic structural check: the artifact exists and looks like a spec. */
const artifactCheck = createScorer<ScenarioBrief, RunOutput, string[]>({
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

/** LLM judge: rubric coverage + faithfulness. The rubric rides `expected`. */
const rubricJudge = createScorer<ScenarioBrief, RunOutput, string[]>({
  name: "rubric-judge",
  scorer: async ({ output, expected }) => {
    const rubric = expected ?? [];
    if (!output.requirementsMd) return { score: 0, metadata: { reason: "no artifact" } };
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { text } = await generateText({
      model: anthropic("claude-sonnet-5"),
      system: `You judge a generated requirements document against a rubric. For each rubric item decide covered=true/false (covered means the document states it, correctly). Also list inventions: substantive requirements in the document that contradict the rubric's spirit. Respond with STRICT JSON: {"items": [{"item": "...", "covered": true, "evidence": "<quote or why not>"}], "inventions": ["..."]}. No markdown fences.`,
      prompt: `RUBRIC:\n${rubric.map((r) => `- ${r}`).join("\n")}\n\nDOCUMENT:\n${output.requirementsMd}`,
    });
    const parsed = JSON.parse(text.trim().replace(/^```(json)?|```$/g, "")) as {
      items: Array<{ item: string; covered: boolean; evidence: string }>;
      inventions: string[];
    };
    const covered = parsed.items.filter((i) => i.covered).length;
    const score = Math.max(0, covered / rubric.length - 0.1 * parsed.inventions.length);
    return { score, metadata: parsed };
  },
});

evalite<ScenarioBrief, RunOutput, string[]>("requirements-section", {
  data: () => scenarios.map((s) => ({ input: s.brief, expected: s.rubric })),
  task: (brief) => runRequirementsSection(PROJECTS, brief),
  scorers: [artifactCheck, rubricJudge],
  columns: ({ output }) => [
    { label: "turns", value: output.turns },
    { label: "questions", value: output.questionsAsked },
    { label: "finished", value: output.finishedInterview },
    { label: "req.md chars", value: output.requirementsMd.length },
    { label: "transcript", value: output.transcriptPath },
  ],
});
