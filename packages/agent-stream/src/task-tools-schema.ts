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
 * The Zod `inputSchema` for the plan-turn tool. It lives HERE (not in the
 * service's tool defs, unlike the file tools) because it is the single
 * definition the design agent uses as tool `inputSchema` AND the source the
 * published JSON Schema is rendered from (`json-schema.ts`) — one definition,
 * no hand-kept copies (mirrors `componentDesignSchema`).
 *
 * PROPERTY ORDER IS LOAD-BEARING: the provider streams properties in
 * declaration order, so the short routable fields come first and the free-text
 * `note` last.
 *
 * The `.describe()` text is the model-facing tool doc; planning behavior stays
 * in the `task-planning` skill.
 */

import { z } from "zod";
import type { BuildPlanInput } from "./contracts/task-tools.js";
import type { Equal } from "./type-equal.js";

const buildPlanItemSchema = z.object({
  item: z
    .string()
    .regex(/^(F[0-9]+|foundation|spec)$/)
    .describe("'foundation' for the shared setup and the product-wide requirements, a carried feature's ID (F2), or 'spec' when the version carries no features."),
  components: z
    .array(z.string())
    .min(1)
    .describe("The design components this item changes (directories under specs/design/components/)."),
  note: z
    .string()
    .describe("One or two sentences: what the coding agent should know before it starts this item."),
});

export const buildPlanInputSchema = z.object({
  items: z.array(buildPlanItemSchema).min(1).describe("The build's checklist, in the order the coding agent works it."),
});

// --- Drift guard: Zod schema ⇄ task-tools wire type (cf. component-design-schema.ts) ---
const _drift: [Equal<z.infer<typeof buildPlanInputSchema>, BuildPlanInput>] = [true];
void _drift;
