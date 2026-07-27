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
 * The streaming chat screen (docs/design/playground.md §7): free-chat turns in
 * the project's single `general` conversation — exactly the console's chat
 * panel. Follow-ups are history-aware; hand-edits between turns are picked up
 * via D20 (`filesChangedExternally`).
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { withGrillingInterview } from "@aep/contracts/prompts";
import { chatTurn, type PhaseOptions } from "../commands.js";
import { collectAnswers } from "./questions.js";
import type { PlaygroundSession } from "../engine/session.js";

/** The per-project chat loop. Returns when the user goes back to the menu or quits. */
export async function chatLoop(session: PlaygroundSession, opts: PhaseOptions): Promise<"menu" | "quit"> {
  const rl = readline.createInterface({ input, output });
  rl.on("SIGINT", () => {
    output.write("\n");
    process.exit(130); // Ctrl-C: hard exit (the in-process server dies with us)
  });
  output.write("  chat — /menu to go back, /quit to exit\n");
  try {
    for (;;) {
      let raw: string;
      try {
        raw = await rl.question(`\n${session.state.slug} ❯ `);
      } catch {
        return "quit"; // stdin closed (Ctrl-D)
      }
      const line = raw.trim();
      if (line === "") continue;
      if (line === "/quit") return "quit";
      if (line === "/menu" || line === "/threads") return "menu";
      if (line === "/help") {
        output.write("  commands: /menu, /quit, /grill [idea], /help\n");
        continue;
      }

      // `/grill [idea]` opts this turn into the interview-first directive (#270),
      // mirroring the console's Generate-spec-with-grilling CTA: the agent asks
      // structured questions before generating. A plain line is an ordinary chat
      // turn (the agent may still ask a question if it needs a decision).
      const instruction = line.startsWith("/grill")
        ? withGrillingInterview(
            line.slice("/grill".length).trim() ||
              "Help me pin down this project's requirements before generating anything.",
          )
        : line;

      // HITL loop (console ADR-0012 / #270): while the agent ends a turn on a
      // question card, prompt for the answer and continue with it as the next
      // instruction. `/skip` (or Ctrl-D at the prompt) drops back to free chat.
      let outcome = await chatTurn(session, instruction, opts);
      while (outcome.ok && outcome.pending) {
        const answer = await collectAnswers(rl, outcome.pending);
        if (answer === null) {
          output.write("  (question skipped)\n");
          break;
        }
        outcome = await chatTurn(session, answer, opts);
      }
      if (!outcome.ok) output.write(`\n[turn failed] ${outcome.detail ?? "unknown error"}\n`);
    }
  } finally {
    rl.close();
  }
}
