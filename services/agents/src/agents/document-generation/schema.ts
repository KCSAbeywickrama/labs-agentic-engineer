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

import { z } from "zod";

/**
 * Body for `POST /internal/v1/agents/document-generation/{skillId}`. Mirrors
 * `DocumentGenerationRequest` in aep-api's `internal/clients/agents/client.go`
 * — `sources` are sibling files (filename → content); `prompt` is the
 * optional user prompt for bootstrap-style skills (e.g.
 * requirements-from-prompt). Byte-identical to agents-legacy's
 * `server/routes/document-generation.ts` RequestBody.
 */
export const DocumentGenerationRequestBody = z.object({
  sources: z.record(z.string(), z.string()).optional(),
  prompt: z.string().optional(),
});

export type DocumentGenerationRequestBody = z.infer<typeof DocumentGenerationRequestBody>;
