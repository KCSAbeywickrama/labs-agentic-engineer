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
 * Headless document-generation runner — the model-facing core, decoupled
 * from SSE. The route (route.ts) wraps this with the wire frames aep-api's
 * `StreamDocumentGeneration` parses; a caller only needs `onDelta` to observe
 * the live text as it streams.
 *
 * Mirrors agents-legacy's `server/routes/document-generation.ts` inline
 * logic: stream the skill's prompt to full text, then — for skills that
 * declare a `postProcess` hook (wireframes/domain-model: DSL → Excalidraw
 * JSON) — run the transform once the stream finishes. A transform failure is
 * reported via `postProcessError` rather than thrown, so the route can still
 * emit the (already-sent) natural `finish` frame before surfacing the error,
 * exactly like legacy's nested try/catch.
 */

import { streamText, type LanguageModel } from "ai";
import type { DocumentGenerationSkill, SkillInput } from "./skills/types.js";

export interface DocumentGenerationRunOpts {
  model: LanguageModel;
  skill: DocumentGenerationSkill;
  input: SkillInput;
  /** Invoked per text chunk as it streams — the route emits each as a `text-delta` frame. */
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
}

export interface DocumentGenerationRunResult {
  /** Raw accumulated text streamed from the model, before any post-process. */
  raw: string;
  /** Final content to persist as the primary file: `raw`, or the skill's
   *  `postProcess.transform` output when the skill declares one and it
   *  succeeded. */
  content: string;
  /** Sibling files to persist alongside `content` (postProcess multi-file
   *  skills only, e.g. wireframes/domain-model's `.dsl` source). */
  siblings?: Record<string, string>;
  /** Set when `skill.postProcess.transform` threw — `content`/`siblings`
   *  above are meaningless in that case (still `raw`, matching legacy which
   *  falls back to the un-transformed accumulation). */
  postProcessError?: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runDocumentGenerationSkill(
  opts: DocumentGenerationRunOpts,
): Promise<DocumentGenerationRunResult> {
  const { model, skill, input, onDelta, abortSignal } = opts;

  const result = streamText({
    model,
    system: skill.systemPrompt,
    prompt: skill.buildUserPrompt(input),
    ...(abortSignal ? { abortSignal } : {}),
    onError: ({ error }) => {
      console.error(`[document-generation/${skill.id}] streamText error:`, error);
    },
  });

  let raw = "";
  for await (const chunk of result.textStream) {
    raw += chunk;
    onDelta?.(chunk);
  }

  const u = await result.usage;
  const usage = { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 };

  if (!skill.postProcess) {
    return { raw, content: raw, usage };
  }

  try {
    const transformed = skill.postProcess.transform(raw);
    const primary = typeof transformed === "string" ? transformed : transformed.primary;
    const siblings = typeof transformed === "string" ? undefined : transformed.siblings;
    return { raw, content: primary, ...(siblings ? { siblings } : {}), usage };
  } catch (err) {
    return {
      raw,
      content: raw,
      postProcessError: err instanceof Error ? err.message : String(err),
      usage,
    };
  }
}
