/**
 * The section driver with FULL tracing. Drives the real agents service through
 * the playground waist (`runSpecTurn` — the same call `chatTurn` wraps), but
 * keeps every StreamPart of every turn:
 *
 *  - evalite traces: one `reportTrace` per turn (visible in the serve UI)
 *  - `<projects>/<name>.transcript.md`: readable agent<->sim conversation
 *  - `<projects>/<name>.trace.json`: the raw StreamPart stream, unabridged
 */
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reportTrace, shouldReportTrace } from "evalite/traces";

import { openSession } from "/home/jo/workspace/labs-agentic-engineer/playground/src/engine/session.js";
import { runSpecTurn } from "/home/jo/workspace/labs-agentic-engineer/playground/src/engine/turn.js";
import { composeSpecInstruction, startInstruction } from "/home/jo/workspace/labs-agentic-engineer/playground/src/engine/compose.js";
import { pendingQuestions } from "/home/jo/workspace/labs-agentic-engineer/playground/src/engine/questions.js";
import {
  buildAnswerInstruction,
  buildAnswersInstruction,
} from "/home/jo/workspace/labs-agentic-engineer/packages/agent-stream/src/index.js";

import { simAnswers, type ScenarioBrief, type SimAnswer } from "./sim-user.js";

export interface TurnRecord {
  turn: number;
  instruction: string;
  /** Concatenated text-deltas — everything the agent said this turn. */
  agentText: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
  toolResults: Array<{ toolName: string; output: unknown }>;
  questions: string[];
  answers: SimAnswer[];
  /** The raw, unabridged StreamPart stream for this turn. */
  parts: unknown[];
  ms: number;
}

export interface RunOutput {
  requirementsMd: string;
  turns: number;
  questionsAsked: number;
  finishedInterview: boolean;
  transcriptPath: string;
  tracePath: string;
  transcript: TurnRecord[];
}

const MAX_TURNS = 8;

export async function runRequirementsSection(
  projectsHome: string,
  brief: ScenarioBrief,
): Promise<RunOutput> {
  const projectDir = join(projectsHome, brief.name);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });

  const session = await openSession(projectDir, {});
  const records: TurnRecord[] = [];
  let questionsAsked = 0;
  let finishedInterview = false;

  try {
    let text = startInstruction(brief.idea);
    while (records.length < MAX_TURNS) {
      const rec: TurnRecord = {
        turn: records.length + 1,
        instruction: text,
        agentText: "",
        toolCalls: [],
        toolResults: [],
        questions: [],
        answers: [],
        parts: [],
        ms: 0,
      };
      const start = Date.now();
      const result = await runSpecTurn(session, composeSpecInstruction(text), {
        onPart: (part) => {
          rec.parts.push(part);
          const p = part as { type: string; text?: string; toolName?: string; input?: unknown; output?: unknown };
          if (p.type === "text-delta" && p.text) rec.agentText += p.text;
          if (p.type === "tool-call") rec.toolCalls.push({ toolName: p.toolName ?? "?", input: p.input });
          if (p.type === "tool-result") rec.toolResults.push({ toolName: p.toolName ?? "?", output: p.output });
        },
      });
      rec.ms = Date.now() - start;
      records.push(rec);
      if (result.error) {
        rec.agentText += `\n[turn error: ${result.error}]`;
        break;
      }

      const pending = pendingQuestions(result.toolCalls);
      if (!pending) {
        finishedInterview = true;
        reportTurnTrace(rec, start);
        break;
      }
      rec.questions = pending.questions.map((q) => q.question);
      questionsAsked += pending.questions.length;
      rec.answers = await simAnswers(brief, pending.questions);
      reportTurnTrace(rec, start);
      text = pending.batch
        ? buildAnswersInstruction(rec.answers)
        : buildAnswerInstruction(rec.answers[0]!.question, rec.answers[0]!.selected, rec.answers[0]!.freeText);
    }
  } finally {
    await session.close();
  }

  const reqPath = join(projectDir, "specs/requirements/requirements.md");
  const requirementsMd = existsSync(reqPath) ? readFileSync(reqPath, "utf8") : "";

  const transcriptPath = join(projectsHome, `${brief.name}.transcript.md`);
  const tracePath = join(projectsHome, `${brief.name}.trace.json`);
  writeFileSync(transcriptPath, renderTranscript(brief, records, requirementsMd));
  writeFileSync(tracePath, JSON.stringify(records, null, 2));

  return {
    requirementsMd,
    turns: records.length,
    questionsAsked,
    finishedInterview,
    transcriptPath,
    tracePath,
    transcript: records,
  };
}

function reportTurnTrace(rec: TurnRecord, start: number): void {
  if (!shouldReportTrace()) return;
  reportTrace({
    input: rec.instruction,
    output: [
      rec.agentText.trim(),
      rec.toolCalls.length ? `tool calls: ${rec.toolCalls.map((t) => t.toolName).join(", ")}` : "",
      rec.questions.length ? `asked:\n${rec.questions.map((q) => `- ${q}`).join("\n")}` : "",
      rec.answers.length
        ? `sim answered:\n${rec.answers.map((a) => `- ${a.selected.join(", ")}${a.freeText ? ` — ${a.freeText}` : ""}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    start,
    end: start + rec.ms,
  });
}

function renderTranscript(brief: ScenarioBrief, records: TurnRecord[], requirementsMd: string): string {
  const lines: string[] = [`# Transcript — ${brief.name}`, "", `Idea: ${brief.idea}`, ""];
  for (const r of records) {
    lines.push(`## Turn ${r.turn} (${(r.ms / 1000).toFixed(1)}s)`, "");
    lines.push("### User -> agent", "", "```", r.instruction, "```", "");
    if (r.agentText.trim()) lines.push("### Agent said", "", r.agentText.trim(), "");
    if (r.toolCalls.length) {
      lines.push("### Tool calls", "");
      for (const t of r.toolCalls) lines.push(`- \`${t.toolName}\` ${JSON.stringify(t.input)?.slice(0, 400)}`);
      lines.push("");
    }
    if (r.answers.length) {
      lines.push("### Sim user answered", "");
      for (const a of r.answers) lines.push(`- **${a.question}** → ${a.selected.join(", ")}${a.freeText ? ` — ${a.freeText}` : ""}`);
      lines.push("");
    }
  }
  lines.push("## Produced requirements.md", "", requirementsMd || "(none)");
  return lines.join("\n");
}
