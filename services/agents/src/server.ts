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
 * The thin Express SSE layer. One turn = one HTTP request:
 *
 *   GET  /healthz                  → 200 (unauthenticated liveness probe)
 *   POST /conversations/:id/turns  → SSE stream of RAW StreamPart frames + [DONE]
 *   GET  /conversations/:id        → rehydrate { status, messages, ... } (404 if unknown)
 *
 * Every conversation route is behind the M2M gate (`aud`-checked Bearer JWT).
 * The turn requires an `X-Anthropic-Key` header — the model is built PER TURN
 * from it (§12.3.1), so the service holds no key of its own; `X-Org-Id` is
 * read for log attribution only. While a turn streams, a `: keep-alive` comment
 * is emitted every `keepAliveMs` so long generations survive an idle ingress.
 *
 * The route maps `runConversationTurn`'s `onEvent` straight to `data: <part>`
 * frames (no envelope). The stream starts LAZILY (on the first event), so a
 * pre-stream failure (400 missing key / invalid body, 409 concurrent turn, 413
 * body too large) is still an HTTP status; once streaming, every failure is an
 * `error` frame then `[DONE]`.
 */

import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { LanguageModel } from "ai";
import { SSE_DONE, type Skill, type StreamPart } from "@aep/agent-stream";
import type { ConversationStore } from "./store/conversation-store.js";
import { runConversationTurn, TurnGuard, ConcurrentTurnError } from "./conversation/run-conversation-turn.js";
import { createAuthMiddleware, type AgentsAuthConfig } from "./shared/auth.js";
import { startKeepAlive } from "./shared/keepalive.js";
import { config } from "./shared/config.js";

export interface CreateAppDeps {
  store: ConversationStore;
  /** Build the model from the request's `X-Anthropic-Key` (§12.3.1). Injected so tests pass a mock. */
  buildModel: (apiKey: string) => LanguageModel;
  /** M2M gate config (always on): JWKS or shared secret. */
  auth: AgentsAuthConfig;
  /** Max request body for the turn endpoint (default `config.bodyLimit`). */
  bodyLimit?: string;
  /** SSE keep-alive cadence in ms (default `config.keepAliveMs`). */
  keepAliveMs?: number;
}

function startSSE(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // defeat proxy buffering of the stream
  res.flushHeaders();
}

export function createApp(deps: CreateAppDeps): Express {
  const app = express();
  const guard = new TurnGuard(); // one in-flight guard per app (serializes turns per id)
  const jsonParser = express.json({ limit: deps.bodyLimit ?? config.bodyLimit });
  const requireAuth = createAuthMiddleware(deps.auth);
  const keepAliveMs = deps.keepAliveMs ?? config.keepAliveMs;

  // Unauthenticated liveness probe (compose/ingress health checks).
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  // Auth runs BEFORE body parsing so an unauthenticated caller can't spend the
  // parser on a large body.
  app.post("/conversations/:id/turns", requireAuth, jsonParser, async (req: Request, res: Response) => {
    const id = req.params.id as string;

    // Per-request Anthropic key (§12.3.1): required, model built per turn.
    const apiKey = req.header("x-anthropic-key");
    if (!apiKey || apiKey.trim() === "") {
      res.status(400).json({ error: "X-Anthropic-Key header is required" });
      return;
    }
    // Org id is attribution-only (§12.3.2) — logged, never trusted for auth.
    const orgId = req.header("x-org-id");
    if (config.logLevel === "debug" && orgId) {
      process.stderr.write(`[turn ${id}] org=${orgId}\n`);
    }

    const body = (req.body ?? {}) as {
      instruction?: unknown;
      files?: unknown;
      filesChangedExternally?: unknown;
      skills?: unknown;
    };

    // Pre-stream validation → HTTP status (no SSE headers sent yet).
    if (typeof body.instruction !== "string" || body.instruction.trim() === "") {
      res.status(400).json({ error: "instruction is required" });
      return;
    }
    if (body.files === null || typeof body.files !== "object" || Array.isArray(body.files)) {
      res.status(400).json({ error: "files (a path→content map) is required" });
      return;
    }
    const fileEntries = Object.entries(body.files as Record<string, unknown>);
    const badEntry = fileEntries.find(([, v]) => typeof v !== "string");
    if (badEntry) {
      res.status(400).json({ error: `files["${badEntry[0]}"] must be a string` });
      return;
    }
    // Validated above (every value is a string) — no rebuild needed.
    const files = body.files as Record<string, string>;

    // skills (optional): the caller-resolved candidate set (ADR-0002). Each must
    // be { name, description, content } strings; reject a malformed payload
    // pre-stream so it's a clean 400, not an opaque mid-stream failure.
    let skills: Skill[] | undefined;
    if (body.skills !== undefined) {
      if (!Array.isArray(body.skills)) {
        res.status(400).json({ error: "skills must be an array" });
        return;
      }
      const isSkill = (s: unknown): s is Skill =>
        s !== null &&
        typeof s === "object" &&
        typeof (s as Record<string, unknown>).name === "string" &&
        typeof (s as Record<string, unknown>).description === "string" &&
        typeof (s as Record<string, unknown>).content === "string";
      if (!body.skills.every(isSkill)) {
        res.status(400).json({ error: "each skill must be { name, description, content } strings" });
        return;
      }
      skills = body.skills;
    }

    // Build the per-turn model from the request key (fail as a pre-stream 500).
    let model: LanguageModel;
    try {
      model = deps.buildModel(apiKey);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "model init failed" });
      return;
    }

    // Abort the turn if the client disconnects mid-stream; stop keep-alives too.
    // A holder (not a bare `let`) so the assignment inside `send` is visible to
    // every read site regardless of control-flow narrowing.
    const ac = new AbortController();
    let started = false;
    const keepAlive: { stop: (() => void) | null } = { stop: null };
    res.on("close", () => {
      ac.abort();
      keepAlive.stop?.();
    });

    // Lazy stream start: headers (and the keep-alive timer) go out on the FIRST
    // event. A failure BEFORE any event (e.g. a concurrent turn) is still a clean
    // HTTP status.
    const send = (part: StreamPart): void => {
      if (!started) {
        startSSE(res);
        started = true;
        keepAlive.stop = startKeepAlive((frame) => res.write(frame), keepAliveMs);
      }
      res.write(`data: ${JSON.stringify(part)}\n\n`);
    };

    try {
      await runConversationTurn({
        id,
        instruction: body.instruction,
        files,
        filesChangedExternally: body.filesChangedExternally === true,
        ...(skills ? { skills } : {}),
        model,
        store: deps.store,
        guard,
        onEvent: send,
        abortSignal: ac.signal,
      });
      if (!started) startSSE(res); // no events emitted — still open + terminate the stream
      res.write(`data: ${SSE_DONE}\n\n`);
      keepAlive.stop?.();
      res.end();
    } catch (err) {
      keepAlive.stop?.();
      if (!started) {
        // Pre-stream failure → HTTP status + JSON.
        if (err instanceof ConcurrentTurnError) {
          res.status(409).json({ error: err.message });
        } else {
          res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
        }
      } else {
        // Already streaming → cannot change status; emit an error frame then [DONE].
        const message = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
        res.write(`data: ${SSE_DONE}\n\n`);
        res.end();
      }
    }
  });

  app.get("/conversations/:id", requireAuth, async (req: Request, res: Response) => {
    const conv = await deps.store.get(req.params.id as string);
    if (!conv) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    // Raw ModelMessage[] — the UI projects tool parts to Changes client-side (§9).
    res.json({
      status: conv.status,
      messages: conv.messages,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    });
  });

  // Body-parser / payload errors → JSON (413 when the snapshot exceeds the limit).
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err); // mid-stream — let the default handler tear down the connection
      return;
    }
    const e = err as { type?: string; status?: number } | null;
    if (e?.type === "entity.too.large" || e?.status === 413) {
      res.status(413).json({ error: "request body exceeds the configured limit" });
      return;
    }
    res.status(400).json({ error: "invalid request body" });
  });

  return app;
}
