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
 * The generic document-generation SSE route — the wire surface aep-api's
 * `StreamDocumentGeneration` speaks (`internal/clients/agents/client.go` →
 * `StreamDocumentGeneration`, consumed by
 * `internal/feature/requirements/requirements_service.go` → `StreamGenerate`).
 * Kept byte-identical to agents-legacy's `server/routes/document-generation.ts`
 * so the cutover is a URL swap:
 *
 *   POST /internal/v1/agents/document-generation/{skillId}
 *     body: { sources?: Record<string,string>, prompt?: string }
 *     → text-delta* { delta }                          (live model output)
 *     → [text-delta { delta, replace: true }]           (postProcess skills only —
 *                                                         discard prior deltas, use this)
 *     → finish                                          (marks the model stream complete)
 *     → [finish { siblings }]                           (postProcess multi-file skills only)
 *     → error { errorText }                             (mid-stream failure)
 *     → [DONE]
 *
 * Streamed as `data: <frame>\n\n` under `text/event-stream`, tagged
 * `x-vercel-ai-ui-message-stream: v1` (matching legacy). aep-api's
 * `requirements_service.go` (and the console's `generateRequirementFile`
 * client) parse ONLY `text-delta` (`delta`, optional `replace`), `finish`
 * (optional `siblings`), and `error` (`errorText`) — every other AI SDK
 * UI-message-stream chunk type legacy passes through is dead weight to both
 * consumers, so this route emits exactly those three frame shapes instead of
 * replaying the full internal SDK event taxonomy.
 *
 * Skill content lives HERE (service-side), not on the wire: aep-api sends
 * only `skillId` (as a path param) + `sources` + `prompt` — the skill's
 * system prompt/body never appears in the request, unlike the architect's
 * builtin-skills-on-the-request model (H1's `skillsApplied`/`builtinSkills`).
 * Skills are ported verbatim from
 * `agents-legacy/src/skills/document-generation/*` into `./skills/`.
 * Unknown `skillId` is a pre-stream HTTP 404 (matching legacy); malformed
 * body is a pre-stream HTTP 400 — both read by aep-api's client.go as a
 * non-200 "agents service error" (raw body text, shape doesn't matter beyond
 * that).
 *
 * AUTH POSTURE: like architect/tech-lead, this service does NOT
 * re-authenticate (behind the platform BFF). The per-org effective Anthropic
 * key travels on `X-Anthropic-Key`; when present the route builds a
 * per-request model from it, otherwise it falls back to the injected
 * composition-root model (dev / eval / tests).
 */

import type { Express, Response } from "express";
import type { LanguageModel } from "ai";
import { createModel } from "../../shared/model.js";
import { DocumentGenerationRequestBody } from "./schema.js";
import { getDocumentGenerationSkill } from "./skills/index.js";
import type { SkillInput } from "./skills/types.js";
import { runDocumentGenerationSkill } from "./run.js";

/** Base path root — kept in sync with aep-api's `agentsBase` (client.go). */
export const DOCUMENT_GENERATION_BASE = "/internal/v1/agents";

/** Header carrying the per-org effective Anthropic key (aep-api resolves it). */
const ANTHROPIC_KEY_HEADER = "x-anthropic-key";

export interface DocumentGenerationDeps {
  /** Fallback model when no `X-Anthropic-Key` header is present (composition root). */
  model: LanguageModel;
}

function writeFrame(res: Response, frame: unknown): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(frame)}\n\n`);
}

/** Per-request model: prefer the forwarded per-org key, else the injected one. */
function resolveModel(res: Response, deps: DocumentGenerationDeps): LanguageModel {
  const key = res.req.header(ANTHROPIC_KEY_HEADER);
  return key && key.length > 0 ? createModel({ apiKey: key }) : deps.model;
}

export function registerDocumentGeneration(app: Express, deps: DocumentGenerationDeps): void {
  app.post(`${DOCUMENT_GENERATION_BASE}/document-generation/:skillId`, async (req, res) => {
    const skillId = req.params.skillId as string;
    const skill = getDocumentGenerationSkill(skillId);
    if (!skill) {
      res.status(404).json({ error: `unknown skill: ${skillId}` });
      return;
    }

    const parsed = DocumentGenerationRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const sources = parsed.data.sources ?? {};
    const input: SkillInput = {
      sources,
      ...(parsed.data.prompt !== undefined ? { prompt: parsed.data.prompt } : {}),
    };

    const model = resolveModel(res, deps);

    console.log(
      `[document-generation/${skillId}] streaming (sources=${Object.keys(sources).length}, hasPrompt=${input.prompt !== undefined})`,
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

    try {
      const result = await runDocumentGenerationSkill({
        model,
        skill,
        input,
        abortSignal: abortController.signal,
        onDelta: (delta) => writeFrame(res, { type: "text-delta", delta }),
      });

      // Natural stream-finished marker — mirrors the AI SDK UI-message-stream
      // `finish` chunk legacy passes through verbatim once the model's text
      // stream ends. aep-api treats this as "the model actually completed"
      // (`sawFinish`); emitted unconditionally, BEFORE any post-processing,
      // exactly like legacy (whose natural finish chunk arrives mid-loop,
      // ahead of the postProcess block that runs after the loop).
      if (!abortController.signal.aborted) writeFrame(res, { type: "finish" });

      if (result.postProcessError) {
        writeFrame(res, { type: "error", errorText: result.postProcessError });
      } else if (skill.postProcess && !abortController.signal.aborted) {
        writeFrame(res, { type: "text-delta", delta: result.content, replace: true });
        if (result.siblings && Object.keys(result.siblings).length > 0) {
          writeFrame(res, { type: "finish", siblings: result.siblings });
        }
      }

      if (!res.writableEnded) res.write("data: [DONE]\n\n");
    } catch (err) {
      console.error(`[document-generation/${skillId}] pipe error:`, err);
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
