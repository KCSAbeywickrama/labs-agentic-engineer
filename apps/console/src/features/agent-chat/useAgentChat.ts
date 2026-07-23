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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { QuestionAnswer } from "@aep/agent-stream";
import { projectKeys } from "../projects/api/keys.js";
import {
  addMessage,
  answerQuestion,
  chatKeyFor,
  conversationIdFor,
  dropTurnOutput,
  getMessages,
  replaceMessages,
  setTurnStatus,
  startNewConversation,
  subscribe,
  type ChatMessage,
} from "./chatStore.js";
import {
  getActiveTurn,
  getConversationMessages,
  startCollabTurn,
} from "./api/turns.js";
import { attachAndFoldTurn } from "./runTurn.js";
import { serializeQuestionAnswer } from "./questionCards.js";
import { projectableHistory } from "./history.js";
import { useCurrentAuthor } from "./currentUser.js";

// The panel's behavior hook (#130): per-project message log, send → collab
// turn → stream fold, mount-time rehydrate + running-turn re-attach. The
// stream abort on unmount only detaches the VIEW — turns run detached
// server-side and a later mount re-attaches via replay.

export interface AgentChat {
  messages: ChatMessage[];
  isSending: boolean;
  /** The turn currently streaming into this log, if any (task 3: the
   *  authoritative "running" signal for the feed, incl. re-attached turns). */
  activeTurnId: string | undefined;
  send: (instruction: string) => void;
  /**
   * Answer a question card (ADR-0012): serializes the choice(s) into the next
   * turn's instruction. The answer is recorded on the card only once the turn
   * actually STARTED — a failed or no-op send leaves the card answerable, so an
   * answer can never be silently lost behind a read-only card.
   */
  answer: (msg: Extract<ChatMessage, { role: "question" }>, answers: QuestionAnswer[]) => void;
  /** Clear the log + mint a fresh conversation id (header action). */
  newConversation: () => void;
}

export function useAgentChat(org: string, projectName: string): AgentChat {
  const chatKey = chatKeyFor(org, projectName);
  const messages = useSyncExternalStore(
    useCallback((fn: () => void) => subscribe(chatKey, fn), [chatKey]),
    () => getMessages(chatKey),
  );
  const [isSending, setIsSending] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const author = useCurrentAuthor();
  const queryClient = useQueryClient();

  // A committed turn changed spec files in git; refetch the project cache tree
  // (spec file list included) so views keyed off committed truth — e.g. the
  // Architecture tab's "Designing…" state — settle instead of serving the
  // staleTime-Infinity snapshot until a reload.
  const onTurnCommitted = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectName) });
  }, [queryClient, projectName]);

  // Mount / project switch: rehydrate an empty log from the server history,
  // then re-attach to a still-running chat turn (replay from 0).
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    void (async () => {
      const convId = conversationIdFor(org, projectName, { create: false });
      if (convId && getMessages(chatKey).length === 0) {
        const history = await getConversationMessages(projectName, convId);
        if (ac.signal.aborted) return;
        if (history && history.length > 0) {
          replaceMessages(chatKey, projectableHistory(history));
        }
      }
      const active = await getActiveTurn(projectName);
      if (ac.signal.aborted || !active || active.status !== "running") return;
      if (active.useCase !== "general") return; // another flow's turn
      setIsSending(true);
      setActiveTurnId(active.turnId);
      dropTurnOutput(chatKey, active.turnId); // replay-from-0 re-adds it all
      try {
        await attachAndFoldTurn(chatKey, projectName, active.turnId, ac.signal, onTurnCommitted, author.id);
      } catch {
        // surfaced by the fold's error handling; the view just settles
      } finally {
        if (!ac.signal.aborted) {
          setIsSending(false);
          setActiveTurnId(undefined);
        }
      }
    })();
    return () => {
      ac.abort();
      setIsSending(false);
      setActiveTurnId(undefined);
    };
  }, [chatKey, org, projectName, onTurnCommitted, author.id]);

  // One turn dispatch, shared by send and answer. `onStarted` fires after
  // startCollabTurn succeeds — the earliest point the instruction is durably on
  // its way to the agent (used to record a card answer only once delivered).
  const dispatch = useCallback(
    (instruction: string, onStarted?: () => void) => {
      const text = instruction.trim();
      if (!text || isSending) return;
      const convId = conversationIdFor(org, projectName, { create: true })!;
      setIsSending(true);
      void (async () => {
        let turnId: string;
        try {
          turnId = await startCollabTurn(projectName, convId, text);
        } catch (err) {
          addMessage(chatKey, {
            role: "user",
            content: text,
            status: "failed",
            author,
            createdAt: Date.now(),
          });
          addMessage(chatKey, {
            role: "error",
            content: err instanceof Error ? err.message : "Failed to reach the agent.",
          });
          setIsSending(false);
          return;
        }
        onStarted?.();
        setActiveTurnId(turnId);
        addMessage(chatKey, {
          role: "user",
          content: text,
          turnId,
          status: "in_flight",
          author,
          createdAt: Date.now(),
        });
        const signal = abortRef.current?.signal ?? new AbortController().signal;
        try {
          await attachAndFoldTurn(chatKey, projectName, turnId, signal, onTurnCommitted, author.id);
        } catch {
          if (!signal.aborted) {
            setTurnStatus(chatKey, turnId, "failed");
            addMessage(chatKey, {
              role: "error",
              content: "Lost the agent's stream — reopen the panel to re-attach.",
            });
          }
        } finally {
          if (!signal.aborted) {
            setIsSending(false);
            setActiveTurnId(undefined);
          }
        }
      })();
    },
    [chatKey, org, projectName, isSending, author, onTurnCommitted],
  );

  const send = useCallback((instruction: string) => dispatch(instruction), [dispatch]);

  const answer = useCallback<AgentChat["answer"]>(
    (msg, answers) => {
      dispatch(serializeQuestionAnswer(msg.questions, answers), () =>
        answerQuestion(chatKey, msg.id, answers),
      );
    },
    [dispatch, chatKey],
  );

  const newConversation = useCallback(() => {
    startNewConversation(org, projectName);
  }, [org, projectName]);

  return { messages, isSending, activeTurnId, send, answer, newConversation };
}
