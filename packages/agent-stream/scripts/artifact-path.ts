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
 * The single location of the published JSON Schema artifact, shared by the
 * generator and the freshness test so they can never disagree. It lives in
 * `packages/contracts` — the cross-service contract home the Go BFF already
 * consumes (alongside `api/v1/openapi.yaml`).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ → packages/agent-stream → packages → contracts/schemas/…
const here = dirname(fileURLToPath(import.meta.url));

export const COMPONENT_DESIGN_SCHEMA_ARTIFACT = join(
  here,
  "..",
  "..",
  "contracts",
  "schemas",
  "component-design.schema.json",
);
