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
 * Headless phase commands (docs/design/playground.md §7): every TUI screen is
 * also a CLI verb with meaningful exit codes, so an edit-skill → rerun loop is
 * scriptable. Each command opens a session, runs its turn(s), and reports a
 * `PhaseOutcome` the CLI maps to an exit code.
 */

import { stdout as output } from "node:process";
import { renderPart, renderSummary } from "@aep/agents/playground-kit";
import type { StreamPart } from "@aep/agent-stream";
import { composeSpecInstruction, buildSpecGenerationInstruction, buildDesignGenerationInstruction } from "./engine/compose.js";
import { designGate, requirementsGate, type GateResult } from "./engine/gates.js";
import { openSession, type OpenOptions, type PlaygroundSession } from "./engine/session.js";
import { runSpecTurn, type SpecTurnResult } from "./engine/turn.js";
import { readPrompt, savePrompt } from "./state/project.js";

export interface PhaseOutcome {
  ok: boolean;
  detail?: string;
}

export interface PhaseOptions extends OpenOptions {
  /** `--target <x>` → production's `\n\n(target: x)` suffix. */
  target?: string;
  /** `--idea "<text>"` seeds/replaces the stored create prompt (requirements). */
  idea?: string;
  /** Quiet streaming (tests); default renders parts live. */
  silent?: boolean;
}

function onPartFor(opts: PhaseOptions): ((part: StreamPart) => void) | undefined {
  return opts.silent ? undefined : renderPart;
}

function report(result: SpecTurnResult, opts: PhaseOptions): PhaseOutcome {
  if (!opts.silent) {
    output.write("\n");
    renderSummary(result.changes, false);
    for (const n of result.derivedNotes) output.write(n.ok ? `  ⚙ ${n.message}\n` : `  ✗ ${n.message}\n`);
    for (const p of result.manifestMismatches) output.write(`  ⚠ manifest mismatch: ${p} (fold drift — please report)\n`);
  }
  if (result.error) return { ok: false, detail: result.error };
  return { ok: true };
}

function gateFail(gate: GateResult): PhaseOutcome {
  return { ok: false, detail: gate.reason ?? "blocked" };
}

/** Run one composed spec turn inside a fresh session (open → turn → close). */
async function runPhaseTurn(projectDir: string, instructionText: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const session = await openSession(projectDir, opts);
  try {
    const onPart = onPartFor(opts);
    const result = await runSpecTurn(session, composeSpecInstruction(instructionText, opts.target), {
      ...(onPart ? { onPart } : {}),
    });
    return report(result, opts);
  } finally {
    await session.close();
  }
}

/**
 * Phase 1 — requirements. The idea comes from `--idea`, the stored
 * `.aep-playground/prompt.md`, or (TUI) an interactive ask; the instruction is
 * the console's "Generate spec" CTA wrapping it (§5 phase 1).
 */
export async function requirementsCommand(
  projectDir: string,
  opts: PhaseOptions,
  askIdea?: () => Promise<string | null>,
): Promise<PhaseOutcome> {
  const gate = requirementsGate();
  if (!gate.ok) return gateFail(gate);

  let idea = opts.idea?.trim() || readPrompt(projectDir);
  if (!idea && askIdea) idea = (await askIdea())?.trim() || null;
  if (idea) savePrompt(projectDir, idea);

  return runPhaseTurn(projectDir, buildSpecGenerationInstruction(idea ?? null), opts);
}

/** Phase 2 — design, derived from the current requirements (§5 phase 2). */
export async function designCommand(projectDir: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const gate = designGate(projectDir);
  if (!gate.ok) return gateFail(gate);
  return runPhaseTurn(projectDir, buildDesignGenerationInstruction(), opts);
}

/** One free-chat turn in the project's `general` conversation (shared session). */
export async function chatTurn(session: PlaygroundSession, text: string, opts: PhaseOptions): Promise<PhaseOutcome> {
  const onPart = onPartFor(opts);
  const result = await runSpecTurn(session, composeSpecInstruction(text, opts.target), {
    ...(onPart ? { onPart } : {}),
  });
  return report(result, opts);
}
