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
 * The render check executes generated code, so it runs isolated:
 *
 *  - in a child process with an EMPTY environment, under Node's permission
 *    model with no grants (no file system, child processes, workers, addons
 *    or inspector), a heap cap and a wall-clock timeout;
 *  - inside that process, in a vm context with JavaScript's built-ins only,
 *    code generation from strings and WebAssembly off, and its own timeout;
 *  - with only strings crossing in (the runtime, the module, the manifest, on
 *    stdin) and out (the findings, on stdout).
 *
 * `node:vm` alone is not a boundary; the process is. What the permission
 * model cannot take away is the network.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SOURCE_FILE, type Finding } from "../findings.js";
import type { PrototypeManifest } from "../manifest/types.js";
import { moduleFactorySource } from "../runtime/module-source.js";
import { transpileSource } from "../source/transpile.js";
import type { ThemeRuntimes } from "./theme.js";

/** How long one render check may take, all screens included. */
export const RENDER_TIMEOUT_MS = 15_000;

/** The child's heap ceiling, in MiB. */
const RENDER_HEAP_MB = 384;

/** The child: read the input from stdin, run the runtime and the module in a fresh context, print the findings. */
const CHILD = `
const vm = require("node:vm");
const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const ctx = vm.createContext({}, { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
vm.runInContext(input.runtime, ctx, { filename: "check-runtime.js", timeout: ${RENDER_TIMEOUT_MS} });
ctx.__protoModuleFactory = vm.runInContext(input.factory, ctx, { filename: "prototype.tsx", timeout: ${RENDER_TIMEOUT_MS} });
ctx.__protoInput = JSON.stringify({ manifest: input.manifest });
process.stdout.write(vm.runInContext("__protoPrototypeCheck(__protoInput)", ctx, { timeout: ${RENDER_TIMEOUT_MS} }));
`;

function permissionFlag(): string {
  return process.allowedNodeEnvironmentFlags.has("--permission") ? "--permission" : "--experimental-permission";
}

/** The most telling line of a child's stderr: the thrown error's message. */
function telling(stderr: string | undefined): string | undefined {
  const lines = (stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^\w*Error\b/.test(l)) ?? lines[lines.length - 1];
}

/** Draws every screen of a prototype whose manifest and source passed their checks; the render findings. */
export function checkRenderIsolated(manifest: PrototypeManifest, source: string, theme: ThemeRuntimes): Finding[] {
  const transpiled = transpileSource(source);
  if (!transpiled.ok) return transpiled.findings;
  const child = spawnSync(process.execPath, [permissionFlag(), `--max-old-space-size=${RENDER_HEAP_MB}`, "-e", CHILD], {
    input: JSON.stringify({ runtime: readFileSync(theme.checkRuntimePath, "utf8"), factory: moduleFactorySource(transpiled.code), manifest }),
    env: {},
    timeout: RENDER_TIMEOUT_MS + 5_000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: "utf8",
  });
  if (child.error || child.status !== 0) {
    const reason = child.error?.message ?? telling(child.stderr) ?? `exit ${String(child.status)}`;
    const timedOut = child.signal === "SIGTERM" || /timed out|ETIMEDOUT/i.test(reason);
    return [
      {
        code: "RENDER_FAILED",
        file: SOURCE_FILE,
        location: "module",
        message: timedOut
          ? `rendering every screen took longer than ${RENDER_TIMEOUT_MS / 1000}s: a screen loops or does far too much work`
          : `the render check failed: ${reason}`,
      },
    ];
  }
  return JSON.parse(child.stdout) as Finding[];
}
