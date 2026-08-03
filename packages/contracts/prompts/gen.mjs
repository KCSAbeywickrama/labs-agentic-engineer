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

// Emits the two generated views of prompts/strings.json — strings.gen.ts
// beside it and services/aep-api/internal/prompts/strings_gen.go — so the
// prompt text is authored exactly once and can never drift between the Go
// composer and the TS consumers (playground, evals, console). Run via the
// package's `gen` script (`make gen` at the root); both outputs are committed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "strings.json"), "utf8"));
delete raw["//"];

const license = (comment) =>
  [
    "Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).",
    "",
    "WSO2 LLC. licenses this file to you under the Apache License,",
    'Version 2.0 (the "License"); you may not use this file except',
    "in compliance with the License.",
    "You may obtain a copy of the License at",
    "",
    "http://www.apache.org/licenses/LICENSE-2.0",
    "",
    "Unless required by applicable law or agreed to in writing,",
    "software distributed under the License is distributed on an",
    '"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY',
    "KIND, either express or implied.  See the License for the",
    "specific language governing permissions and limitations",
    "under the License.",
  ]
    .map((l) => `${comment}${l ? " " + l : ""}`)
    .join("\n");

const banner = "Code generated from packages/contracts/prompts/strings.json by prompts/gen.mjs. DO NOT EDIT.";

// ── strings.gen.ts ───────────────────────────────────────────────────────────
const tsEntries = Object.entries(raw)
  .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
  .join("\n");
writeFileSync(
  join(here, "strings.gen.ts"),
  `/**\n${license(" *")}\n */\n\n// ${banner}\n\n${tsEntries}\n`,
);

// ── strings_gen.go ───────────────────────────────────────────────────────────
const goName = (k) => k[0].toUpperCase() + k.slice(1);
const goEntries = Object.entries(raw)
  .map(([k, v]) => `const ${goName(k)} = ${JSON.stringify(v)}`)
  .join("\n");
const goDir = join(here, "..", "..", "..", "services", "aep-api", "internal", "prompts");
mkdirSync(goDir, { recursive: true });
writeFileSync(
  join(goDir, "strings_gen.go"),
  `${license("//")}\n\n// ${banner}\n\n// Package prompts holds the generated prompt strings shared with the TS\n// consumers via packages/contracts/prompts/strings.json — the single authored\n// copy. Edit the JSON and run \`make gen\`; never edit this file.\npackage prompts\n\n${goEntries}\n`,
);

