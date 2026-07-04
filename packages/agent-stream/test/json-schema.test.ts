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
 * Anti-drift gate: the checked-in JSON Schema artifact must equal a fresh render
 * of `componentDesignSchema`. If this fails, the Zod schema changed without
 * regenerating — run `pnpm --filter @aep/agent-stream gen`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDesignJsonSchema } from "../src/json-schema.js";
import { COMPONENT_DESIGN_SCHEMA_ARTIFACT } from "../scripts/artifact-path.js";

test("checked-in component-design.schema.json matches a fresh generation", () => {
  const onDisk = readFileSync(COMPONENT_DESIGN_SCHEMA_ARTIFACT, "utf8");
  const fresh = `${JSON.stringify(componentDesignJsonSchema(), null, 2)}\n`;
  assert.equal(
    onDisk,
    fresh,
    "component-design.schema.json is stale — run `pnpm --filter @aep/agent-stream gen`",
  );
});

test("the schema is a strict object exposing the ComponentDesign fields", () => {
  const schema = componentDesignJsonSchema() as {
    type?: string;
    additionalProperties?: boolean;
    required?: string[];
    properties?: Record<string, unknown>;
  };
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false, "strictObject → additionalProperties:false for the BFF gate");
  for (const key of ["name", "type", "version", "language", "buildpack", "appPath", "entrypoint", "exposure", "connections", "description"]) {
    assert.ok(schema.properties && key in schema.properties, `missing property ${key}`);
    assert.ok(schema.required?.includes(key), `expected ${key} required`);
  }
});
