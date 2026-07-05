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
 * The DSL→Excalidraw render route — the wire surface aep-api's `RenderDsl`
 * speaks (`internal/clients/agents/client.go` → `RenderDsl`, POSTs
 * `{kind, dsl}` and expects `200 {excalidraw}`). Cluster-internal helper used
 * by the BFF after a canvas-structural tool result, to re-render the
 * `.excalidraw` sibling from the agent-edited `.dsl`. Unlike every other
 * route in this service it is a stateless, org-less transform — no model,
 * no streaming, plain JSON in, plain JSON out:
 *
 *   POST /internal/v1/dsl/render
 *     body: { kind: "wireframes" | "domain-model", dsl: string }
 *     → 200 { excalidraw: string }
 *     → 400 { error: string }   (bad kind/dsl shape, or the transform threw)
 *
 * Kept byte-identical to agents-legacy's `server/routes/internal-dsl.ts` so
 * the cutover is a URL swap. The actual DSL→Excalidraw compiler lives in
 * `@aep/excalidraw-dsl` (the single workspace copy also used by the
 * `wireframes`/`domain-model` document-generation skills' postProcess step —
 * see `../document-generation/skills/wireframes.ts`).
 *
 * AUTH POSTURE: like every other route here, this service does NOT
 * re-authenticate (behind the platform BFF, which authenticates); see
 * `techlead/route.ts`'s AUTH POSTURE note for the fuller rationale.
 */

import type { Express } from "express";
import { dslToExcalidraw, type DslKind } from "@aep/excalidraw-dsl";

/** Base path root — kept in sync with aep-api's `internalBase` (client.go). */
export const DSL_RENDER_BASE = "/internal/v1/dsl";

const VALID_KINDS = new Set<DslKind>(["wireframes", "domain-model"]);

function isDslKind(kind: unknown): kind is DslKind {
  return typeof kind === "string" && VALID_KINDS.has(kind as DslKind);
}

export interface DslRenderDeps {
  /**
   * Injectable in tests to exercise the "transform threw" → 400 branch
   * deterministically (`@aep/excalidraw-dsl`'s `dslToExcalidraw` is, by
   * construction, a total function over any `string` DSL — it degrades to an
   * empty/best-effort scene rather than throwing on malformed syntax, so
   * there is no reasonable hand-authored DSL that reaches this branch).
   * Production callers omit this and get the real compiler.
   */
  transform?: (kind: DslKind, dsl: string) => string;
}

export function registerDslRender(app: Express, deps: DslRenderDeps = {}): void {
  const transform = deps.transform ?? dslToExcalidraw;

  app.post(`${DSL_RENDER_BASE}/render`, (req, res) => {
    const body = req.body as { kind?: unknown; dsl?: unknown };
    const { kind, dsl } = body;

    if (!isDslKind(kind) || typeof dsl !== "string") {
      res.status(400).json({
        error: "kind must be 'wireframes' or 'domain-model'; dsl must be a string",
      });
      return;
    }

    try {
      const excalidraw = transform(kind, dsl);
      res.json({ excalidraw });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
