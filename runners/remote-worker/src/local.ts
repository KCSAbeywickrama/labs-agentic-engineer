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

// Local-mode entrypoint — oneshot.ts's sibling for the AEP playground: the
// workspace IS a plain local project dir (no clone, no credhelper, no PAT),
// and the workflow skill is the SAME `aep` skill production loads, with
// `overlays/local.md` applied for `mode: "local"` (edit-in-place, no PR). See
// base_plugin.ts: both modes read one authored SKILL.md, so the project
// conventions the playground exists to tune cannot drift from the ones a real
// run uses.
// Mirrors prod's milestone dispatch (`docs/decisions/ADR-0011`; playground
// decision: `playground/design/decisions/ADR-0001-milestone-batch-coding-run.md`):
// the run is scoped to the WHOLE project, not one issue — the prompt names
// nothing but the project, and the `aep-local` skill discovers its own
// working set from the issue files on disk (App-Path existence, not a stored
// flag), orders them, and works as many as it can in one session. The same
// runClaudeQuery drives the SDK session; the same NDJSON progress contract
// streams on stdout; the same exit codes report the result:
//
//   0 — the session did what it could (some issues may remain open — normal)
//   1 — the agent gave up entirely
//   2 — setup/unexpected error before the agent ran
//
// Env contract (stamped by the playground CLI):
//   AEP_LOCAL_PROJECT_DIR  the project directory (becomes the cwd)
//   AEP_LOCAL_SKILLS_DIR   the skill library — ONE dir serving both the base
//                          plugin and the project's applied skills
//                          (default: ../skills, the library baked into the image)
//   AEP_LOCAL_RUN_DIR      scratch/log dir (default: <project>/.aep-playground/runner)
//   ANTHROPIC_API_KEY      OPTIONAL. Present (the containerised playground run,
//                          which can reach no credential store) → the SDK
//                          session authenticates with it. Absent (a `--host`
//                          run) → the SDK falls back to the developer's own
//                          Claude credentials, the ones `claude login` wrote.
//                          Not validated here: this entrypoint cannot tell
//                          which of the two it is in, and the caller can — the
//                          playground refuses a keyless docker run up front.
//
// This module imports nothing outside the package — remote-worker stays
// workspace-dep-free for its standalone image.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaudeQuery } from "./lib/runner.js";
import { openTaskLog } from "./lib/logger.js";
import type { DispatchRequest } from "./lib/types.js";
import type { WorkspaceLayout } from "./lib/workspace.js";
import { emit, primeScrubber } from "./lib/progress/emitter.js";
import { installConsoleScrubber } from "./lib/progress/console_scrub.js";
import { resolveTaskSkills } from "./lib/skills_resolver.js";
import { listMirroredSkills, readSkillBodies, resolvePinnedSkills } from "./lib/skills_presence.js";
import { mirrorLocalSkillLibrary } from "./lib/local_skill_mirror.js";
import { BASE_PLUGIN_SKILLS } from "./lib/base_plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The SAME authored library production reads (repo-root `skills/`, baked in at
// /app/skills). `mode: "local"` below is what applies the local overlay to its
// workflow skill; the playground bind-mounts its working tree over this path.
const DEFAULT_LIBRARY = path.resolve(__dirname, "../skills");

// A run is scoped to the whole project, not one component — the agent works
// every open issue it discovers and may touch several components. This is a
// LABEL VALUE ONLY (mirrors prod's `aep-milestone` sentinel,
// `delivery/codingagent/milestone_dispatch.go`): nothing resolves project
// content through it, and skills are read at `{kind: "project"}` scope
// instead (the union of every component's `design.json`), never off this name.
const LOCAL_MILESTONE_SENTINEL = "aep-local-milestone";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}

interface LocalRun {
  projectDir: string;
  /** The skill library: the base plugin is assembled from it, applied skills resolved out of it. */
  libraryDir: string;
  runDir: string;
}

function readLocalRunFromEnv(): LocalRun {
  const projectDir = path.resolve(requireEnv("AEP_LOCAL_PROJECT_DIR"));

  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`AEP_LOCAL_PROJECT_DIR is not a directory: ${projectDir}`);
  }

  const libraryDir = process.env.AEP_LOCAL_SKILLS_DIR || DEFAULT_LIBRARY;
  if (!fs.existsSync(libraryDir)) {
    throw new Error(`skill library does not exist: ${libraryDir}`);
  }
  const runDir = process.env.AEP_LOCAL_RUN_DIR || path.join(projectDir, ".aep-playground", "runner");

  return { projectDir, libraryDir, runDir };
}

// The workspace IS the project dir; the auth-flavored layout fields point at
// empty scratch entries so runClaudeQuery's env composition stays untouched
// (an unauthenticated GH_CONFIG_DIR, an empty bearer file, an empty PATH dir).
function localDirWorkspace(run: LocalRun): WorkspaceLayout {
  const ghConfigDir = path.join(run.runDir, "gh-config");
  const aepDir = path.join(run.runDir, "bin");
  const bearerFile = path.join(run.runDir, "bearer");
  fs.mkdirSync(ghConfigDir, { recursive: true });
  fs.mkdirSync(aepDir, { recursive: true });
  fs.writeFileSync(bearerFile, "", "utf8");
  return {
    workspace: run.projectDir,
    ghConfigDir,
    bearerFile,
    aepDir,
    helperBin: path.join(aepDir, "credhelper"), // never provisioned in local mode
    ghWrapper: path.join(aepDir, "gh"), // never provisioned in local mode
  };
}


async function main(): Promise<number> {
  installConsoleScrubber();

  let run: LocalRun;
  try {
    run = readLocalRunFromEnv();
  } catch (err) {
    console.error("[local] env validation failed:", err instanceof Error ? err.message : String(err));
    return 2;
  }

  primeScrubber([process.env.ANTHROPIC_API_KEY]);
  emit({ kind: "phase", phase: "workspace_provisioning" });

  let layout: WorkspaceLayout;
  try {
    layout = localDirWorkspace(run);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ kind: "result", status: "failure", error: `workspace_provisioning: ${msg}` });
    return 2;
  }
  emit({ kind: "phase", phase: "workspace_ready" });

  // Per-task skills: the same pin read as production, resolved against
  // `.claude/skills/` in the project dir — the SAME location the SDK discovers
  // natively via `cwd: layout.workspace` (== run.projectDir here). No clone, no
  // second plugin. The playground has no BFF, so it writes that mirror itself,
  // applying the production copy rule so a local run sees the same filtered set
  // a real project would. Pins are read BEFORE the mirror because they are an
  // INPUT to that rule.
  //
  // `withheld` is the runner's own base-plugin selection. Those three skills
  // reach the session from the assembled plugin, so mirroring them too would put
  // a second copy of the workflow in the same session — and in local mode the
  // mirrored copy is the un-overlaid GitHub procedure, which is the exact
  // failure ADR-0004 decision 1 exists to prevent.
  //
  // Failure degrades to the base plugin, loudly.
  let availableSkillNames: string[] = [];
  let pinnedBodies = "";
  try {
    const pinned = await resolveTaskSkills({
      workspace: run.projectDir,
      // A run works the whole project, same as prod's milestone loop — the
      // union of every component's skillsPinned, never one componentName.
      scope: { kind: "project" },
      log: (l) => console.log(l),
    });
    await mirrorLocalSkillLibrary(run.libraryDir, run.projectDir, new Set(pinned), (l) => console.log(l), {
      withheld: new Set(BASE_PLUGIN_SKILLS),
    });
    const { preload, dangling } = await resolvePinnedSkills(run.projectDir, pinned, (l) => console.log(l));
    if (dangling.length > 0) {
      console.warn(`[local] ⚠️  pinned skill(s) missing from .claude/skills/ — proceeding without them: ${dangling.join(", ")}`);
    }
    // The whole mirror is allowed (the SDK rejects anything unlisted); the
    // pinned subset additionally rides in on the system prompt.
    availableSkillNames = await listMirroredSkills(run.projectDir);
    pinnedBodies = await readSkillBodies(run.projectDir, preload);
    console.log(
      `[local] ${availableSkillNames.length} skill(s) available, ${preload.length} pinned into context`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[local] ⚠️  SKILLS UNAVAILABLE — proceeding without per-task skills: ${msg}`);
  }

  const req: DispatchRequest = {
    taskId: randomUUID(),
    orgId: "play",
    projectId: path.basename(run.projectDir).toLowerCase(),
    componentName: LOCAL_MILESTONE_SENTINEL,
    repoUrl: "",
    bearer: "",
    identity: { name: "AEP Playground", email: "playground@localhost" },
    gitServiceUrl: "",
    // Same shape as prod's dispatch prompt: the run's subject, then a pointer at
    // the skill for the procedure. The pointer clause is duplicated in the BFF's
    // Go `buildPrompt` (delivery/codingagent/coding_executor.go) because the two
    // prompts are authored either side of a language boundary; the shared clause
    // is pinned by playground/test/steer-parity.test.ts so the skill it names
    // can't drift out from under one of them.
    prompt:
      "Work the issues in this project. Follow the `aep` skill loaded in your session — " +
      "it defines discovery, ordering, fan-out, verification and how to finish.",
    taskKind: "implementation",
  };

  const log = openTaskLog(run.runDir);
  // Assemble the base plugin CONTAINER-LOCAL, never under run.runDir. In docker
  // mode that dir is a bind mount from the host, and the assembler copies the
  // plugin tree with fs.cpSync — which fails EACCES on the mount even at mode
  // 0777 and even though mkdir, write and shell `cp -r` all succeed there. It is
  // the file-sharing backend, not the permissions: the same cpSync into /tmp
  // works. Composing into the mount killed every docker-mode run before the
  // agent started. So "what text did the agent actually read?" is answered by
  // `make runner-plugin` off the critical path, not by the run dir.
  const composeDir = path.join(os.tmpdir(), "aep-base-plugin", req.taskId);
  const { completion } = runClaudeQuery(req, layout, log, { availableSkillNames, pinnedBodies }, {
    libraryPath: run.libraryDir,
    mode: "local",
    composeDir,
  });
  const result = await completion;
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[local] unhandled error:", err);
    process.exit(2);
  });
