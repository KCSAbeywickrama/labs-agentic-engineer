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
 * POST /build's selection and hard gate, and the build issue's render, through
 * aep-api's own code: spawns `cmd/build-plan` (as the code run spawns
 * `cmd/design-derive`, ADR-0003), so a local build is refused where
 * production's would be (the build gate over specs/design and the acceptance
 * files included), a local plan carries what production's would, and its issue
 * file holds the bytes the plan service would mint.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { BuildPlanItem, PlanScope } from "@aep/agent-stream";
import { REPO_ROOT } from "../paths.js";

const AEP_API_DIR = join(REPO_ROOT, "services", "aep-api");

/** What one run of the CLI said. `spawnError` is set when the process never started. */
export interface BuildPlanProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: NodeJS.ErrnoException;
}

/** Runs `build-plan` with these arguments and stdin. Injected by tests. */
export type BuildPlanRunner = (args: string[], stdin?: string) => Promise<BuildPlanProcessResult>;

/** A build's selection: the pick, and what earlier versions carried. */
export interface Selection {
  version: string;
  features?: string[];
  productWide?: string[];
  builtFeatures?: string[];
  builtProductWide?: string[];
}

/** What a build carries (`reqspec.BuildPlan`). */
export interface CarriedPlan {
  features: string[];
  pulledIn: string[];
  productWide: string[];
  heldBack: string[];
}

export type ScopeOutcome = { ok: true; plan: CarriedPlan; scope: PlanScope } | { ok: false; detail: string };
export type IssueOutcome = { ok: true; title: string; body: string } | { ok: false; detail: string };

const goRun: BuildPlanRunner = (args, stdin) =>
  new Promise((resolve) => {
    const child = spawn("go", ["run", "./cmd/build-plan", ...args], { cwd: AEP_API_DIR, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => resolve({ code: null, stdout, stderr, spawnError: err }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });

function selectionArgs(projectDir: string, s: Selection): string[] {
  const list = (flag: string, ids: string[] | undefined): string[] => (ids?.length ? [flag, ids.join(",")] : []);
  return [
    "--requirements-dir",
    join(projectDir, "specs", "requirements"),
    "--version",
    s.version,
    ...list("--features", s.features),
    ...list("--product-wide", s.productWide),
    ...list("--built-features", s.builtFeatures),
    ...list("--built-product-wide", s.builtProductWide),
  ];
}

function failure(result: BuildPlanProcessResult): string {
  if (result.spawnError) {
    return result.spawnError.code === "ENOENT"
      ? "`go` is not on PATH. Planning selects the build with aep-api's Go code (playground ADR-0003); install Go and re-run"
      : `could not start build-plan: ${result.spawnError.message}`;
  }
  const lines = result.stderr.trim().split("\n").filter(Boolean);
  return result.code === 1 ? `the build is refused: ${lines.join("; ")}` : lines.pop() ?? `build-plan exited ${String(result.code)}`;
}

/** The folders POST /build's gate reads besides the requirements, as the tag would hold them. */
function gateArgs(projectDir: string): string[] {
  return ["--design-dir", join(projectDir, "specs", "design"), "--acceptance-dir", join(projectDir, "specs", "validation", "acceptance")];
}

/**
 * What a build of `selection` carries, and the plan turn's scope; or why it is
 * refused: the selection's refusals and POST /build's gate findings, together.
 */
export async function selectBuild(projectDir: string, selection: Selection, runner: BuildPlanRunner = goRun): Promise<ScopeOutcome> {
  const result = await runner(["scope", ...selectionArgs(projectDir, selection), ...gateArgs(projectDir)]);
  if (result.code !== 0) return { ok: false, detail: failure(result) };
  const out = JSON.parse(result.stdout) as { plan: CarriedPlan; scope: PlanScope };
  return { ok: true, plan: out.plan, scope: out.scope };
}

/** The build issue the plan service would mint for this selection and checklist. */
export async function renderBuildIssue(
  projectDir: string,
  selection: Selection,
  items: BuildPlanItem[],
  runner: BuildPlanRunner = goRun,
): Promise<IssueOutcome> {
  const result = await runner(["issue", ...selectionArgs(projectDir, selection)], JSON.stringify({ items }));
  if (result.code !== 0) return { ok: false, detail: failure(result) };
  const out = JSON.parse(result.stdout) as { title: string; body: string };
  return { ok: true, title: out.title, body: out.body };
}
