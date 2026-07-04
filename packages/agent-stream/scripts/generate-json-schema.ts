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
 * Regenerate the checked-in `component-design.schema.json` artifact from the Zod
 * schema. Wired into this package's `gen` script (turbo `build` runs `gen`
 * first), so the artifact cannot silently drift from `componentDesignSchema`;
 * `test/json-schema.test.ts` fails the build if it does.
 *
 *   pnpm --filter @aep/agent-stream gen
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { componentDesignJsonSchema } from "../src/json-schema.js";
import { COMPONENT_DESIGN_SCHEMA_ARTIFACT } from "./artifact-path.js";

const json = `${JSON.stringify(componentDesignJsonSchema(), null, 2)}\n`;
mkdirSync(dirname(COMPONENT_DESIGN_SCHEMA_ARTIFACT), { recursive: true });
writeFileSync(COMPONENT_DESIGN_SCHEMA_ARTIFACT, json, "utf8");
process.stdout.write(`wrote ${COMPONENT_DESIGN_SCHEMA_ARTIFACT}\n`);
