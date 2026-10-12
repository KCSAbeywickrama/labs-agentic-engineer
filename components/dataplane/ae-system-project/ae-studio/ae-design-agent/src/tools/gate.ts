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
 * "Draft first, act on the user's go-ahead" for every registered write
 * (`./registry.ts`), enforced in code (`../agents/confirmation.ts`). Text the
 * model reads — an issue's body or comments, a search result, something the
 * user pasted — can try to talk it into a write the user never confirmed, or
 * into writing something else than what they confirmed. So each tool with a
 * confirmation refuses unless THIS turn's instruction is the single answer to
 * its own question selecting its own option; the one tool that answer confirms
 * runs at most once, and only with the change the card the user answered
 * showed (`describeChange`).
 */

import type { AskQuestionInput } from "@aep/agent-stream";
import type { ToolSet } from "ai";
import { answeredWith, onceAsShown, refusing } from "../agents/confirmation.js";
import { registeredTool, TOOLS } from "./registry.js";

/** The one write `instruction` confirms: the registered tool whose question it answers with its option. */
export function confirmedTool(instruction: string): string | undefined {
  return Object.keys(TOOLS).find((name) => {
    const confirm = TOOLS[name]!.confirm;
    return confirm !== undefined && answeredWith(instruction, confirm.question, confirm.option);
  });
}

/**
 * Gate every tool in `tools` that has a confirmation on this turn's
 * instruction and the card the user answered (`asked`, `answerableQuestion`
 * over the stored history). The write the instruction confirms runs once,
 * only with the change `asked` showed; every other write refuses with a tool
 * error naming the question to ask. Tools without a confirmation pass through
 * untouched, and a set with no write comes back as it is. Call it once per
 * turn: the once-state lives in the returned tools.
 */
export function gateConfirmations(tools: ToolSet, instruction: string, asked: AskQuestionInput | undefined): ToolSet {
  const confirmed = confirmedTool(instruction);
  let gated: ToolSet | undefined;
  for (const [name, tool] of Object.entries(tools)) {
    const confirm = registeredTool(name)?.confirm;
    if (confirm === undefined) continue;
    const { question, option, decline } = confirm;
    gated ??= { ...tools };
    gated[name] =
      name === confirmed
        ? onceAsShown(
            tool,
            confirm,
            confirm.change,
            asked,
            "Already attempted in this turn; tell the user the result and ask before trying again.",
          )
        : refusing(
            tool,
            `Not done. Ask the user "${question}" with ask_question (options ${option} / ${decline}) and act only after they answer ${option}.`,
          );
  }
  return gated ?? tools;
}
