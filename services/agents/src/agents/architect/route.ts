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
 * The architect SSE route — the wire surface aep-api's StreamGenerateDesign
 * speaks (`internal/clients/agents/client.go` → `StreamArchitect`, parsed by
 * `internal/feature/design/design_service.go`). Kept byte-identical to
 * agents-legacy's `server/routes/architect.ts` so the cutover is a URL swap:
 *
 *   POST /internal/v1/agents/architect
 *     → data-overview / data-component-added / data-component-removed /
 *       data-component-updated / data-component-spec-updating (progress; the
 *       console renders these) … then the ONE frame the BFF assembles the
 *       design from:
 *     → data-finish { design: { overview, components: [DesignComponent] } }
 *     → error { errorText }   (top-level errorText — NOT nested in `data`)
 *     → data: [DONE]
 *
 * Streamed as `data: <frame>\n\n` under a `text/event-stream` response tagged
 * `x-vercel-ai-ui-message-stream: v1`. Pre-stream body validation is a plain
 * HTTP 400. The BFF proxies every frame downstream and only PARSES `data-finish`
 * (design.overview + design.components as `[]models.DesignComponent`, so the
 * emitted components MUST carry `componentType`/`openAPISpec`) and top-level
 * `error.errorText`.
 *
 * AUTH POSTURE: like the task-planner route, this service does NOT re-authenticate
 * (behind the platform BFF). The per-org effective Anthropic key travels on
 * `X-Anthropic-Key`; when present the route builds a per-request model from it,
 * otherwise it falls back to the injected composition-root model (dev / eval /
 * tests). The additive `mcp` block (url + per-run bearer) drives the
 * dependency-discovery tools via `shared/mcp-client.ts` (best-effort).
 */

import type { Express, Response } from "express";
import type { LanguageModel } from "ai";
import { createModel } from "../../shared/model.js";
import { loadMcpTools } from "../../shared/mcp-client.js";
import { ArchitectInput } from "./schema.js";
import { runArchitect } from "./run.js";
import type { SseSink, FinalizeResolver } from "./tools.js";

/** Base path root — kept in sync with aep-api's `agentsBase` (client.go). */
export const ARCHITECT_BASE = "/internal/v1/agents";

/** Header carrying the per-org effective Anthropic key (aep-api resolves it). */
const ANTHROPIC_KEY_HEADER = "x-anthropic-key";

export interface ArchitectDeps {
  /** Fallback model when no `X-Anthropic-Key` header is present (composition root). */
  model: LanguageModel;
}

function writeFrame(res: Response, frame: unknown): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(frame)}\n\n`);
}

/** Per-request model: prefer the forwarded per-org key, else the injected one. */
function resolveModel(res: Response, deps: ArchitectDeps): LanguageModel {
  const key = res.req.header(ANTHROPIC_KEY_HEADER);
  return key && key.length > 0 ? createModel({ apiKey: key }) : deps.model;
}

export function registerArchitect(app: Express, deps: ArchitectDeps): void {
  app.post(`${ARCHITECT_BASE}/architect`, async (req, res) => {
    const parsed = ArchitectInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const model = resolveModel(res, deps);

    console.log(
      `[architect] streaming (spec ${parsed.data.spec.length} chars, incremental=${parsed.data.previousDesign ? "yes" : "no"})`,
    );

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "x-vercel-ai-ui-message-stream": "v1",
    });
    res.flushHeaders?.();

    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    // Prevent the OC API gateway idle-timeout from dropping the SSE connection
    // while waiting for the model. SSE comments are forwarded by the BFF and
    // ignored by browser SSE parsers.
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(": keep-alive\n\n");
    }, 15_000);

    const sink: SseSink = {
      send(event, data) {
        if (res.writableEnded) return;
        writeFrame(res, { type: `data-${event}`, data });
      },
      isClosed() {
        return res.writableEnded;
      },
    };

    const finalizer: FinalizeResolver = {
      finalized: false,
      resolve: () => {
        // Once finalize() emits data-finish, we no longer need the model to
        // keep talking. Aborting the stream tears down the SDK loop cleanly.
        abortController.abort();
      },
    };

    // aep-api attaches an additive `mcp` block (url + a per-run bearer token) to
    // the request when it wants dependency-discovery tools available to the
    // architect (client.go StreamArchitect). Absent ⇒ no discovery tools.
    // Best-effort: an unreachable/unauthorized MCP server degrades to no
    // discovery tools, never fails the turn.
    const extraTools = parsed.data.mcp ? await loadMcpTools(parsed.data.mcp) : {};

    try {
      const { finalized, finishReason } = await runArchitect({
        model,
        input: parsed.data,
        sink,
        finalizer,
        abortSignal: abortController.signal,
        extraTools,
      });

      // Loop ended without finalize() succeeding. Could be: stepCountIs hit,
      // model gave up, or upstream error. Emit an error so the BFF does not
      // write a partial design.
      if (!finalized && !res.writableEnded) {
        // Anthropic maps a model-level safety refusal to finishReason
        // "content-filter" — the model declines the input and returns almost no
        // output. Surface it distinctly so the user rephrases rather than
        // reading it as an agent malfunction.
        const refused = finishReason === "content-filter";
        writeFrame(res, {
          type: "error",
          errorText: refused
            ? "The AI assistant declined this request as it appears to conflict with its usage policies. Please rephrase and try again."
            : "architect agent ended without calling finalize — design not produced",
        });
      }

      if (!res.writableEnded) res.write("data: [DONE]\n\n");
    } catch (err) {
      // runArchitect swallows the expected finalize-abort; anything reaching
      // here is a real error (or a client-disconnect abort, where the socket is
      // already gone and the guarded writes simply no-op).
      console.error("[architect] pipe error:", err);
      if (!res.writableEnded) {
        writeFrame(res, {
          type: "error",
          errorText: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      clearInterval(keepAlive);
      if (!res.writableEnded) res.end();
    }
  });
}
