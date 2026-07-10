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

// Fold a turn's SSE stream into chat-store messages (#130). Collab turns put
// the FILE changes in the live room doc, so the panel folds only narration
// (text deltas), tool results (cards), errors, and the one aep-api terminal.

import { parseSseStream, toChange, type StreamPart } from "@aep/agent-stream";
import {
  appendAssistantText,
  addMessage,
  setTurnStatus,
} from "./chatStore.js";
import { getTurn, openTurnStream } from "./api/turns.js";

const FILE_TOOLS = new Set(["addFile", "editFile", "removeFile"]);

/**
 * Attach to a running turn's stream and fold it to its terminal. Resolves
 * when the turn reaches a terminal (or the signal aborts — the turn keeps
 * running server-side; a later re-attach replays it). A severed stream falls
 * back to one authoritative status poll.
 */
export async function attachAndFoldTurn(
  chatKey: string,
  projectName: string,
  turnId: string,
  signal: AbortSignal,
): Promise<void> {
  let sawTerminal = false;

  const fold = (part: StreamPart): void => {
    switch (part.type) {
      case "text-delta":
        appendAssistantText(chatKey, turnId, part.delta ?? part.text ?? "");
        break;
      case "tool-result": {
        if (!part.toolName || !FILE_TOOLS.has(part.toolName)) break;
        const change = toChange(part);
        addMessage(chatKey, {
          role: "tool",
          turnId,
          op: change.op,
          path: change.path,
          ok: change.result?.ok !== false,
          ...(change.result && !change.result.ok
            ? { errorText: change.result.message }
            : {}),
        });
        break;
      }
      case "error":
        addMessage(chatKey, {
          role: "error",
          content: typeof part.error === "string" ? part.error : "The agent hit an error.",
        });
        break;
      case "turn-committed":
        sawTerminal = true;
        setTurnStatus(chatKey, turnId, "completed");
        break;
      case "turn-failed":
        sawTerminal = true;
        setTurnStatus(chatKey, turnId, "failed");
        addMessage(chatKey, {
          role: "error",
          content:
            (part as { message?: string }).message ?? "The agent turn failed.",
        });
        break;
      default:
        break; // start/finish/tool-input plumbing — nothing to render
    }
  };

  try {
    const body = await openTurnStream(projectName, turnId, 0, signal);
    for await (const part of parseSseStream(body)) {
      if (signal.aborted) return;
      fold(part);
    }
  } catch (err) {
    if (signal.aborted) return; // unmount/navigation — not a failure
    throw err;
  }

  if (sawTerminal || signal.aborted) return;
  // Severed before the terminal — one authoritative poll settles the bubble.
  const status = await getTurn(projectName, turnId);
  if (status?.status === "completed") {
    setTurnStatus(chatKey, turnId, "completed");
  } else if (status?.status === "failed") {
    setTurnStatus(chatKey, turnId, "failed");
    addMessage(chatKey, {
      role: "error",
      content: status.message ?? "The agent turn failed.",
    });
  }
}
