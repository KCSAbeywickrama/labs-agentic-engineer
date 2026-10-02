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
 * Seam 1's harness: the built `prototype` bin as a child process, with an
 * explicit environment, and the fixture folders it runs over. Tests assert on
 * what an agent or a developer sees — exit codes, output, files.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BIN = join(PACKAGE_ROOT, "dist", "bin.js");
export const FIXTURES = join(PACKAGE_ROOT, "test", "fixtures");

/** PATH and HOME are what node needs, and no more. */
export const CHILD_ENV = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" };

export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(args: readonly string[], options: { cwd?: string; timeoutMs?: number } = {}): CliRun {
  const run = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd ?? PACKAGE_ROOT,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60_000,
    env: CHILD_ENV,
  });
  if (run.error) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

export function fixturePath(name: string): string {
  return join(FIXTURES, name);
}

export function tempDir(prefix = "prototype-cli-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface JsonFinding {
  code: string;
  file: string;
  location: string;
  message: string;
}

export function checkJson(dir: string, timeoutMs?: number): { status: number | null; ok: boolean; findings: JsonFinding[] } {
  const run = runCli(["check", "--json", dir], timeoutMs === undefined ? {} : { timeoutMs });
  const report = JSON.parse(run.stdout) as { ok: boolean; findings: JsonFinding[] };
  return { status: run.status, ...report };
}
