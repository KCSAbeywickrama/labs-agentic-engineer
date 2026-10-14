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
 * `/v1/projects/{p}/...`: a project chat's current conversation, its
 * messages, rotation, turn start, the active turn, a turn's status and its
 * stream. A project has a main chat and a chat per area, narrowed or not to
 * a focus (`conversations/chat.ts`), named by the `area` and `focus` query on
 * the reads that are not addressed by a conversation id; a turn's scope is its chat: one running turn each, any
 * kind. Only the main chat rotates.
 */

import express, { type Request, type Response, type Router } from "express";
import { ChatError, chatFromQuery, chatKey, issueOf, type Chat } from "../conversations/chat.js";
import { isProjectName, TurnStartError } from "../turns/start-turn.js";
import { notFound, sendProblem, sendTurnStartError } from "./http.js";
import { creditOf, userOf, type RouteContext } from "./routes.js";
import { resumeFrom, streamTurn } from "./sse.js";
import { startTurnRoute } from "./start-turn-route.js";

export function projectRoutes(ctx: RouteContext): Router {
  const { deps } = ctx;
  const router = express.Router({ mergeParams: true });
  const projectOf = (req: Request): string => req.params.project as string;
  const scopeOf = (req: Request, chat?: Chat) => ({
    kind: "project" as const,
    project: projectOf(req),
    ...(chat ? { chat: chatKey(chat) } : {}),
  });
  /** The chat the query names, or `null` once a 400 invalid_chat is answered. */
  const chatOf = (req: Request, res: Response): Chat | null => {
    try {
      return chatFromQuery(req.query);
    } catch (err) {
      if (!(err instanceof ChatError)) throw err;
      sendProblem(res, 400, "invalid_chat", err.message);
      return null;
    }
  };

  // A name that cannot be a project is unknown on every route.
  router.use((req, res, next) => {
    if (isProjectName(projectOf(req))) next();
    else notFound(res, "project_unknown");
  });

  router.get("/conversations/current", async (req, res) => {
    const chat = chatOf(req, res);
    if (!chat) return;
    const issue = issueOf(chat);
    if (issue !== undefined) {
      // A closed issue has no thread: none is opened for it.
      try {
        await deps.turns.checkIssueOpen(projectOf(req), issue);
      } catch (err) {
        if (!(err instanceof TurnStartError)) throw err;
        if (err.code === "issue_unknown") notFound(res, "issue_unknown");
        else sendProblem(res, err.status, err.code, err.message);
        return;
      }
    }
    res.json(deps.threads.current(projectOf(req), userOf(res).name, chat));
  });

  router.post("/conversations", async (req, res) => {
    // A rotation under a running turn would leave its save writing an
    // orphan thread, so it waits for the turn (as aep-api's did).
    const active = deps.desk.active(scopeOf(req));
    if (active) {
      sendTurnStartError(res, new TurnStartError(409, "turn_in_progress", "a turn is running", active.turnId));
      return;
    }
    res.status(201).json(await deps.threads.rotate(projectOf(req), userOf(res).name));
  });

  router.get("/conversations/:conversationId/messages", async (req, res) => {
    const messages = await deps.threads.history(projectOf(req), req.params.conversationId as string);
    if (!messages) {
      notFound(res, "conversation_unknown");
      return;
    }
    res.json({ messages });
  });

  router.post(
    "/conversations/:conversationId/turns",
    startTurnRoute((req, res, input) =>
      deps.turns.startProjectTurn({
        project: projectOf(req),
        conversationId: req.params.conversationId as string,
        input,
        credit: creditOf(res),
      }),
    ),
  );

  router.get("/turns/active", (req, res) => {
    // A read: it does not ask whether an issue is open, so a turn still
    // running after its issue closed stays reachable on reload.
    const chat = chatOf(req, res);
    if (!chat) return;
    const active = deps.desk.active(scopeOf(req, chat));
    if (active) res.json(active);
    else res.status(204).end();
  });

  /** A turn of THIS project, or `null`: a turn id never answers under another project. */
  const turnOf = (req: Request) => {
    const status = deps.desk.status(req.params.turnId as string);
    return status && status.project === projectOf(req) ? status : null;
  };

  router.get("/turns/:turnId", (req, res) => {
    const status = turnOf(req);
    if (status) res.json(status);
    else notFound(res, "turn_unknown");
  });

  router.get("/turns/:turnId/stream", async (req, res) => {
    if (!turnOf(req)) {
      notFound(res, "turn_unknown");
      return;
    }
    await streamTurn(req, res, deps.desk, req.params.turnId as string, resumeFrom(req), ctx.keepAliveMs);
  });

  return router;
}
