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

import { runConversation, type AskFn } from "./conversation.js";
import type { Scenario } from "./scenario.js";

/**
 * promptfoo's unit is a prompt and its output; ours is a conversation. The
 * bridge is this provider: it runs the whole conversation and returns the
 * TRANSCRIPT as `output`, which promptfoo's rubrics then grade. promptfoo's
 * `prompts:` field is satisfied but unused — the scenario drives, not a prompt.
 */
export default class AgentEvalProvider {
  private readonly config: { maxTurns?: number };

  constructor(options?: { config?: { maxTurns?: number } }) {
    this.config = options?.config ?? {};
  }

  id(): string {
    return "aep:agent-eval";
  }

  async callApi(
    _prompt: string,
    context?: { vars?: { scenario?: Scenario; ask?: AskFn } },
  ): Promise<{ output: string; metadata: Record<string, unknown> }> {
    const scenario = context?.vars?.scenario;
    const ask = context?.vars?.ask;
    if (!scenario || !ask) throw new Error("agent-eval: scenario and ask are required vars");
    const t = await runConversation({
      scenario,
      ask,
      ...(this.config.maxTurns === undefined ? {} : { maxTurns: this.config.maxTurns }),
    });
    return { output: t.text, metadata: { turns: t.turns, scenarioId: scenario.id } };
  }
}
