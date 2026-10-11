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
 * Scenario runners: drivers + scoring composed per section, and the chain
 * (#357: live production-shaped handoff — requirements→design continue ONE
 * conversation, tasks runs detached; halt on fail-band with downstream marked
 * skipped; per-section verdicts, never a blended number).
 *
 * Scoring runs INSIDE the task (not in evalite scorers) so the chain can band
 * a section before deciding to continue; the .eval.ts scorers only extract.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openSession } from "@aep/playground/src/engine/session.js";
import { DESIGN_COMMAND, interviewCommand, START_COMMAND } from "@aep/contracts/commands";

// The design flow, sent verbatim as the console sends it: the design agent
// parses the command and composes the wording.
const designTurn = DESIGN_COMMAND;

/** The kickoff, with the scenario's idea inline (an inline idea wins over the descriptor's). */
function startTurn(idea: string): string {
  return `${START_COMMAND} ${idea.trim()}`;
}
import { FIXTURES_DIR, PROJECTS_HOME } from "./config.js";
import { listRequirementFiles, prepareProject, readProjectFile, readRequirementTexts } from "./project.js";
import type { ChainScenario, DesignScenario, RequirementsScenario, Rubric, TasksScenario } from "./scenario.js";
import { decisionsDigest, type SimAnswer } from "./sim-user.js";
import { runConversationalSection, type SectionRunResult } from "./drivers/conversational.js";
import { runTaskPlanSection, type TaskPlanRunResult } from "./drivers/task-plan.js";
import { sectionVerdict, type SectionVerdict } from "./scoring/bands.js";
import { judgeArtifact, orgDefaults, type JudgeReport } from "./scoring/judge.js";
import { designChecks, requirementsChecks, tasksChecks, type StructuralReport } from "./scoring/structural.js";
import { emitReviewSheet, type ReviewSection } from "./scoring/review-sheet.js";
import { sumUsage, writeRunArtifacts, type TurnRecord, type TurnUsage } from "./tracing.js";
import { listFlows } from "@aep/playground/src/engine/gates.js";

export interface SectionOutcome {
  section: string;
  verdict: SectionVerdict;
  structural: StructuralReport;
  judge: JudgeReport | null;
  turns: number;
  questionsAsked: number;
  skipped: boolean;
}

export interface EvalRunOutput {
  scenario: string;
  outcomes: SectionOutcome[];
  usage: TurnUsage;
  transcriptPath: string;
  tracePath: string;
  reviewSheetPath: string | null;
}

/** The artifact each section's judge reads, clipped defensively. */
const CLIP = 80_000;
const clip = (s: string): string =>
  s.length > CLIP ? `${s.slice(0, CLIP)}\n…(clipped at ${CLIP} characters — later files were NOT judged)` : s;

function requirementsArtifact(projectDir: string): string {
  return listRequirementFiles(projectDir)
    .map((rel) => `--- ${rel} ---\n${readProjectFile(projectDir, rel)}`)
    .join("\n\n");
}

/** The list items a design run added to the requirements (the gap check's lines), per file. */
function addedRequirementLines(before: Record<string, string>, after: Record<string, string>): string {
  const lines: string[] = [];
  for (const [path, text] of Object.entries(after)) {
    const was = new Set((before[path] ?? "").split("\n").map((l) => l.trim()));
    const added = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(?:-|\d+\.)\s+\S/.test(l) && !was.has(l));
    if (added.length > 0) lines.push(`${path}:`, ...added.map((l) => `  ${l}`));
  }
  return lines.join("\n");
}

/**
 * What the design judge reads, in the lineup's order, the prototype's source
 * last (it is the longest file, and the clip cuts from the end).
 */
function designArtifact(projectDir: string, requirementsBefore?: Record<string, string>): string {
  const labeled = (rel: string): string => {
    const content = readProjectFile(projectDir, rel);
    return content ? `--- ${rel} ---\n${content}` : "";
  };
  const componentsDir = join(projectDir, "specs/design/components");
  const components = existsSync(componentsDir) ? readdirSync(componentsDir).sort() : [];
  const dependenciesDir = join(projectDir, "specs/design/dependencies");
  const dependencies = existsSync(dependenciesDir) ? readdirSync(dependenciesDir).sort() : [];
  const added = requirementsBefore ? addedRequirementLines(requirementsBefore, readRequirementTexts(projectDir)) : "";
  const parts: string[] = [
    added ? `--- requirements lines this run added (the gap check) ---\n${added}` : "",
    labeled("specs/design/design.cell"),
    labeled("specs/design/domain-model.md"),
    // The security step's artifact: the judge cannot score a permission
    // catalog or a grant set it never sees.
    labeled("specs/design/security.json"),
    labeled("specs/design/decisions.md"),
  ];
  for (const c of components) {
    for (const f of ["design.json", "prototype.json", "openapi.yaml", "agent.afm.md"]) {
      parts.push(labeled(`specs/design/components/${c}/${f}`));
    }
  }
  for (const d of dependencies) {
    for (const f of ["dependency.json", "assumptions.md"]) parts.push(labeled(`specs/design/dependencies/${d}/${f}`));
  }
  for (const f of listFlows(projectDir)) {
    parts.push(labeled(`specs/design/flows/${f}`));
  }
  for (const c of components) parts.push(labeled(`specs/design/components/${c}/prototype.tsx`));
  return parts.filter(Boolean).join("\n\n");
}

function tasksArtifact(projectDir: string): string {
  const dir = join(projectDir, "issues");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => /^\d+\.md$/.test(f))
    .sort((a, b) => Number.parseInt(a) - Number.parseInt(b))
    .map((f) => `--- issues/${f} ---\n${readFileSync(join(dir, f), "utf8")}`)
    .join("\n\n");
}

/**
 * `requirementsBefore` (design only): the requirements as the design run
 * found them, so the gap check is scored by what the run added.
 */
async function scoreConversational(
  projectDir: string,
  run: SectionRunResult,
  rubric: Rubric,
  priorAnswers: SimAnswer[],
  requirementsBefore?: Record<string, string>,
): Promise<SectionOutcome> {
  const isDesign = run.section === "design";
  const structural = isDesign ? await designChecks(projectDir, run, requirementsBefore) : requirementsChecks(projectDir, run);
  const artifact = isDesign ? designArtifact(projectDir, requirementsBefore) : requirementsArtifact(projectDir);
  const digest = decisionsDigest([...priorAnswers, ...run.answers]);
  const org = orgDefaults();
  const judge = artifact.trim()
    ? await judgeArtifact({
        rubric,
        artifactLabel: isDesign
          ? "software design (the requirements lines it added, design.cell, domain-model.md, security.json, decisions.md, per component design.json + prototype + openapi.yaml/agent.afm.md, dependencies, flows)"
          : "requirements document",
        artifact: clip(artifact),
        ...(digest ? { decisionsDigest: digest } : {}),
        ...(org ? { orgDefaults: org } : {}),
      })
    : null;
  return {
    section: run.section,
    verdict: sectionVerdict(run.section, structural.score, judge?.weightedScore ?? null, (judge?.mustNotViolations.length ?? 0) > 0),
    structural,
    judge,
    turns: run.records.length,
    questionsAsked: run.questionsAsked,
    skipped: false,
  };
}

async function scoreTasks(projectDir: string, run: TaskPlanRunResult, rubric: Rubric): Promise<SectionOutcome> {
  const structural = tasksChecks(projectDir, run);
  const artifact = tasksArtifact(projectDir);
  const judge = artifact.trim()
    ? await judgeArtifact({
        rubric,
        artifactLabel: "task plan (the folded issues/*.md set)",
        artifact: clip(artifact),
      })
    : null;
  return {
    section: "tasks",
    verdict: sectionVerdict("tasks", structural.score, judge?.weightedScore ?? null, (judge?.mustNotViolations.length ?? 0) > 0),
    structural,
    judge,
    turns: run.records.length,
    questionsAsked: 0,
    skipped: false,
  };
}

function skippedOutcome(section: string): SectionOutcome {
  return {
    section,
    verdict: { section, structural: 0, judge: null, score: 0, band: "fail", forcedReview: false },
    structural: { score: 0, checks: [] },
    judge: null,
    turns: 0,
    questionsAsked: 0,
    skipped: true,
  };
}

function finishRun(
  evalName: string,
  scenarioName: string,
  runName: string,
  records: TurnRecord[],
  outcomes: SectionOutcome[],
  artifacts: Record<string, string>,
): EvalRunOutput {
  const { transcriptPath, tracePath } = writeRunArtifacts(PROJECTS_HOME, runName, records, artifacts);
  const sections: ReviewSection[] = outcomes.map((o) => ({
    verdict: o.verdict,
    structural: o.structural,
    judge: o.judge,
    ...(o.skipped ? { skipped: true } : {}),
  }));
  const reviewSheetPath = emitReviewSheet({ scenario: scenarioName, evalName, sections, transcriptPath, tracePath });
  return {
    scenario: scenarioName,
    outcomes,
    usage: sumUsage(records),
    transcriptPath,
    tracePath,
    reviewSheetPath,
  };
}

/**
 * Copy the attached documents where the platform overlays them. The design
 * agent reads them from its workspace snapshot of that folder, so the kickoff
 * names nothing.
 */
function attachReferences(projectDir: string, names: string[]): void {
  for (const name of names) {
    mkdirSync(join(projectDir, "specs/requirements/references"), { recursive: true });
    cpSync(join(FIXTURES_DIR, "references", name), join(projectDir, `specs/requirements/references/${name}`));
  }
}

/** A feature file's ID: `F2` for specs/requirements/features/F2-approvals.md. */
const FEATURE_FILE_ID = /^specs\/requirements\/features\/(F\d+)-[^/]+\.md$/;

/**
 * The requirements section as the console runs it: the product pass (`/start`)
 * writes the product page and a stub per feature, then each feature is
 * interviewed on its own (`/interview F<n>`), in ID order, in the same
 * conversation. One section result: the turns, questions and answers of all
 * of them, finished only when every one finished.
 */
async function runRequirementsSection(
  session: Awaited<ReturnType<typeof openSession>>,
  projectDir: string,
  brief: RequirementsScenario["brief"],
): Promise<SectionRunResult> {
  attachReferences(projectDir, brief.references ?? []);
  const runs = [await runConversationalSection(session, "requirements", startTurn(brief.idea), brief)];
  if (!runs[0]!.error) {
    const features = listRequirementFiles(projectDir).flatMap((f) => FEATURE_FILE_ID.exec(f)?.[1] ?? []);
    for (const id of features) {
      const run = await runConversationalSection(session, "requirements", interviewCommand(id), brief);
      runs.push(run);
      if (run.error) break;
    }
  }
  const error = runs.find((r) => r.error)?.error;
  return {
    section: "requirements",
    records: runs.flatMap((r) => r.records),
    questionsAsked: runs.reduce((n, r) => n + r.questionsAsked, 0),
    finishedInterview: runs.every((r) => r.finishedInterview),
    answers: runs.flatMap((r) => r.answers),
    ...(error ? { error } : {}),
  };
}

export async function runRequirementsScenario(sc: RequirementsScenario, runName: string): Promise<EvalRunOutput> {
  const projectDir = prepareProject(runName);
  const session = await openSession(projectDir, {});
  let run: SectionRunResult;
  try {
    run = await runRequirementsSection(session, projectDir, sc.brief);
  } finally {
    await session.close();
  }
  const outcome = await scoreConversational(projectDir, run, sc.rubric, []);
  return finishRun("requirements-section", sc.brief.name, runName, run.records, [outcome], {
    "specs/requirements/": requirementsArtifact(projectDir),
  });
}

export async function runDesignScenario(sc: DesignScenario, runName: string): Promise<EvalRunOutput> {
  const projectDir = prepareProject(runName, sc.fixture);
  const requirementsBefore = readRequirementTexts(projectDir);
  const session = await openSession(projectDir, {});
  let run: SectionRunResult;
  try {
    run = await runConversationalSection(session, "design", designTurn, sc.brief);
  } finally {
    await session.close();
  }
  const outcome = await scoreConversational(projectDir, run, sc.rubric, [], requirementsBefore);
  return finishRun("design-section", sc.brief.name, runName, run.records, [outcome], {
    "specs/design/": designArtifact(projectDir, requirementsBefore),
  });
}

export async function runTasksScenario(sc: TasksScenario, runName: string): Promise<EvalRunOutput> {
  const projectDir = prepareProject(runName, sc.fixture);
  const run = await runTaskPlanSection(projectDir, sc.scope);
  const outcome = await scoreTasks(projectDir, run, sc.rubric);
  return finishRun("tasks-section", sc.name, runName, run.records, [outcome], {
    "issues/": tasksArtifact(projectDir),
  });
}

export async function runChainScenario(sc: ChainScenario, runName: string): Promise<EvalRunOutput> {
  const projectDir = prepareProject(runName);
  const records: TurnRecord[] = [];
  const outcomes: SectionOutcome[] = [];

  // Requirements → design share ONE conversation (the console flow); the
  // session stays open across both.
  const session = await openSession(projectDir, {});
  let designSkipped = false;
  let requirementsAnswers: SimAnswer[] = [];
  try {
    const req = await runRequirementsSection(session, projectDir, sc.brief);
    records.push(...req.records);
    requirementsAnswers = req.answers;
    const reqOutcome = await scoreConversational(projectDir, req, sc.rubrics.requirements, []);
    outcomes.push(reqOutcome);

    if (reqOutcome.verdict.band === "fail") {
      designSkipped = true;
    } else {
      const requirementsBefore = readRequirementTexts(projectDir);
      const design = await runConversationalSection(session, "design", designTurn, sc.brief);
      records.push(...design.records);
      const designOutcome = await scoreConversational(projectDir, design, sc.rubrics.design, requirementsAnswers, requirementsBefore);
      outcomes.push(designOutcome);
    }
  } finally {
    await session.close();
  }

  if (designSkipped) {
    outcomes.push(skippedOutcome("design"), skippedOutcome("tasks"));
  } else if (outcomes[1]!.verdict.band === "fail") {
    outcomes.push(skippedOutcome("tasks"));
  } else {
    // Tasks runs detached (its own session), exactly as production's build click.
    const tasks = await runTaskPlanSection(projectDir);
    records.push(...tasks.records);
    outcomes.push(await scoreTasks(projectDir, tasks, sc.rubrics.tasks));
  }

  return finishRun("chain", sc.brief.name, runName, records, outcomes, {
    "specs/requirements/": requirementsArtifact(projectDir),
    "specs/design/": designArtifact(projectDir),
    "issues/": tasksArtifact(projectDir),
  });
}

/** The chain's headline: the per-section verdict vector (#357). */
export function verdictVector(out: EvalRunOutput): string {
  return out.outcomes
    .map((o) => `${o.section}:${o.skipped ? "skipped" : o.verdict.band}`)
    .join(" / ");
}
