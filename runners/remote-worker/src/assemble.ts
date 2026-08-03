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

// Dev CLI (`make runner-plugin`) — writes the base plugin a session would load,
// so a human can install it into their own Claude Code:
//
//   make runner-plugin            # github mode (what the platform dispatches)
//   MODE=local make runner-plugin # what a playground run reads
//   claude plugin install <printed path>
//
// It exists because the plugin is no longer a checked-in directory: it is
// assembled from the library per run. Rather than keep a second, hand-authored
// copy for people to install (which would drift — that is the whole point of
// ADR-0004), this runs the SAME assembler a session runs.
//
// Never shipped in the production image (`.dockerignore`), and never on a run's
// path: `oneshot.ts` and `local.ts` call the assembler directly.
//
// Env:
//   AEP_LIBRARY_DIR  the skill library  (default: the checkout's repo-root
//                    skills/ — this CLI runs from a checkout, never in the image
//                    where the library is baked at /app/skills)
//   AEP_PLUGIN_OUT   where to write it  (default: ../.plugin-dev)
//   MODE             github | local     (default: github)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBasePlugin, type AgentMode } from "./lib/base_plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readMode(): AgentMode {
  const raw = process.env.MODE ?? "github";
  if (raw !== "github" && raw !== "local") {
    throw new Error(`MODE must be "github" or "local", got ${JSON.stringify(raw)}`);
  }
  return raw;
}

const libraryDir = process.env.AEP_LIBRARY_DIR ?? path.resolve(__dirname, "../../../skills");
const destDir = process.env.AEP_PLUGIN_OUT ?? path.resolve(__dirname, "../.plugin-dev");
const mode = readMode();

const out = assembleBasePlugin({ libraryDir, destDir, mode });
console.log(`assembled the ${mode} base plugin from ${libraryDir}`);
console.log(out);
