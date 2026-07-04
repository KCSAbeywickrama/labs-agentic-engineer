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
 * Publish `componentDesignSchema` as a JSON Schema so the Go BFF save-gate
 * validates component `design.json` against the SAME definition the agent's
 * write-gate (`checkComponentDesign`) enforces — one schema, not two hand-kept
 * copies (§8 of the migration decision record).
 *
 * The structural schema is the shared contract. The one contextual rule the
 * agent adds — `name` must equal the component directory — is NOT expressible in
 * a standalone JSON Schema (it needs the path), so both sides apply it
 * separately (the agent in `checkComponentDesign`, the BFF at its save-gate).
 *
 * `scripts/generate-json-schema.ts` writes the checked-in artifact from this;
 * `test/json-schema.test.ts` fails if the artifact drifts from a fresh render.
 */

import { z } from "zod";
import { componentDesignSchema } from "./component-design-schema.js";

/** The `ComponentDesign` structural schema as JSON Schema (draft 2020-12). */
export function componentDesignJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(componentDesignSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}
