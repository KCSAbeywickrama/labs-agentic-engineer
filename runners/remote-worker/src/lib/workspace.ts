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

// Per-task workspace provisioning.
//
// On dispatch the BFF creates a WorkflowRun of `aep-coding-agent`
// and Argo schedules an ephemeral pod whose entrypoint (src/oneshot.ts)
// calls this function. We clone the project's repo on its **default
// branch** into $WORKSPACE_BASE_PATH/<orgId>/<projectId>/<taskId>/ and
// configure `.git/config` + `gh` so the agent can git/gh against GitHub
// without ever seeing a token in environment variables. The agent itself
// creates the feature branch and opens the PR with `Closes #<issueNumber>`
// — see remote-worker/plugin/skills/aep/SKILL.md.
//
// The clone and every operation after it authenticate through the SAME
// credential helper (lib/credhelper.ts): the clone gets it via `git -c`, since
// `.git/config` does not exist yet, and step 2 installs it durably afterwards.
// The runner process itself never holds a GitHub token.
//
// Layout inside the workspace:
//
//   <workspace>/
//     .git/                     ← cloned repo, default branch checked out
//     .gh-config/hosts.yml      ← gh's auth config (rewritten by ghWrapper)
//     .aep/
//       bearer                  ← chmod 600 — per-task JWT
//       credhelper.sh           ← chmod 700 — git credential helper
//       gh                      ← chmod 755 — gh wrapper, on PATH
//
// The agent runs with cwd=<workspace> and PATH prefixed with <workspace>/.aep
// so `gh ...` resolves to the wrapper. No tokens cross via process env.

import fs from "node:fs";
import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { CREDHELPER_FILE, credHelperScript, ghWrapperScript } from "./credhelper.js";
import { cloneCredentialScope, cloneWithHelper } from "./git_clone.js";
import { shellQuote } from "./shell.js";

const execAsync = promisify(exec);

export interface WorkspaceLayout {
  workspace: string;
  ghConfigDir: string;
  bearerFile: string;
  aepDir: string;
  helperBin: string;
  ghWrapper: string;
}

export interface ProvisionRequest {
  orgId: string;
  projectId: string;
  taskId: string;
  repoUrl: string;
  bearer: string;
  identity: { name: string; email: string; login?: string };
  gitServiceUrl: string;
  correlationId?: string;
  // WS2.6 — full refresh URL, set by oneshot.ts to the path-scoped
  // `${platformUrl}/internal/v1/executions/{executionId}/credentials/refresh`
  // (accepts both publisher-cc and legacy Task-JWT; taskId carries the
  // execution id, §9.2). Falls back to a path-scoped URL built from
  // gitServiceUrl below when unset.
  refreshUrl?: string;
}

// computeLayout names every path the dispatch flow touches. Pure function
// so tests can verify the path layout without filesystem effects.
export function computeLayout(orgId: string, projectId: string, taskId: string): WorkspaceLayout {
  const workspace = path.join(config.workspaceBasePath, orgId, projectId, taskId);
  const aepDir = path.join(workspace, ".aep");
  return {
    workspace,
    ghConfigDir: path.join(workspace, ".gh-config"),
    bearerFile: path.join(aepDir, "bearer"),
    aepDir,
    helperBin: path.join(aepDir, CREDHELPER_FILE),
    ghWrapper: path.join(aepDir, "gh"),
  };
}

// resolveRefreshUrl is the one owner of the credentials/refresh endpoint URL.
// It is baked into the helper script at provisioning time, so the clone and
// every later git operation cannot end up pointed at different endpoints.
//
// WS2.6 — req.refreshUrl (set by oneshot.ts from AEP_PLATFORM_URL) is already
// the path-scoped endpoint. The fallback builds the same path-scoped URL from
// gitServiceUrl for the rare case oneshot didn't set it.
function resolveRefreshUrl(req: ProvisionRequest): string {
  if (req.refreshUrl && req.refreshUrl !== "") return req.refreshUrl;
  const url = new URL(req.gitServiceUrl);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.pathname += `internal/v1/executions/${encodeURIComponent(req.taskId)}/credentials/refresh`;
  return url.toString();
}

// provisionWorkspace clones the feature branch and writes credentials.
// Idempotent: it removes any existing workspace first (§12.1 step 5
// resume-safety: a crash mid-clone leaves DispatchedAt=null, the resume
// sweep re-enters this step, which begins with rm -rf).
//
// Order matters: `git clone <url> <dir>` refuses to write into an existing
// non-empty directory. So we stage the bearer AND the credential helper in a
// sibling tmp dir, clone into the workspace path (which must not exist yet)
// authenticating through that staged helper, and only then drop the .aep/ and
// .gh-config/ directories inside the cloned tree.
export async function provisionWorkspace(req: ProvisionRequest): Promise<WorkspaceLayout> {
  const layout = computeLayout(req.orgId, req.projectId, req.taskId);
  const stageDir = layout.workspace + ".stage";

  // Wipe both the target and any prior stage. Don't pre-create the workspace
  // dir — git clone will materialise it.
  await fs.promises.rm(layout.workspace, { recursive: true, force: true });
  await fs.promises.rm(stageDir, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(layout.workspace), { recursive: true, mode: 0o755 });
  await fs.promises.mkdir(stageDir, { recursive: true, mode: 0o700 });

  // The helper body is generated ONCE and written twice, byte-identical: to the
  // stage dir for the clone, and into the cloned tree for the agent. It reads
  // the bearer from $AEP_BEARER_FILE, so only that path differs between the two
  // phases — the script itself is never rewritten, which is what makes "one
  // credential flow" literal rather than aspirational.
  const helperBody = credHelperScript({
    taskId: req.taskId,
    workspaceDir: layout.workspace,
    refreshUrl: resolveRefreshUrl(req),
  });

  // Stage the bearer and helper in the sibling dir: they have to live somewhere
  // outside the not-yet-existing workspace, and are removed with it below.
  const stageBearer = path.join(stageDir, "bearer");
  const stageHelper = path.join(stageDir, CREDHELPER_FILE);
  await fs.promises.writeFile(stageBearer, req.bearer, { mode: 0o600 });
  await fs.promises.writeFile(stageHelper, helperBody, { mode: 0o700 });

  try {
    // Clone the PLAIN URL, authenticating through the staged helper (see
    // git_clone.ts). No token is passed to git at all — the helper mints one
    // itself — so nothing lands in argv, in the error message on failure, or in
    // .git/config. The durable copy of the same helper is installed below and is
    // what authenticates the agent's own later fetch/push.
    //
    // No --branch: clone the remote's default branch (HEAD). The agent
    // creates its own feature branch via `git checkout -b ...` once it
    // starts working, per the aep skill workflow.
    await cloneWithHelper({
      repoUrl: req.repoUrl,
      destDir: layout.workspace,
      helperPath: stageHelper,
      bearerFile: stageBearer,
    });

    // Materialise the runtime layout inside the cloned tree.
    await fs.promises.mkdir(layout.aepDir, { recursive: true, mode: 0o755 });
    await fs.promises.mkdir(layout.ghConfigDir, { recursive: true, mode: 0o755 });
    await fs.promises.writeFile(layout.bearerFile, req.bearer, { mode: 0o600 });
    await fs.promises.writeFile(layout.helperBin, helperBody, { mode: 0o700 });

    // gh wrapper (chmod 755). Resolve the real gh binary path eagerly so the
    // wrapper doesn't have to. If gh is not on PATH we fall back to
    // /usr/bin/env gh and let the wrapper fail at run time with a useful error.
    let realGhPath = "gh";
    try {
      const which = await execAsync("which gh");
      realGhPath = which.stdout.trim() || "gh";
    } catch {
      realGhPath = "/usr/bin/env gh";
    }
    await fs.promises.writeFile(layout.ghWrapper, ghWrapperScript(realGhPath), { mode: 0o755 });

    // .git/config: commit identity + the durable credential helper. The scope is
    // derived from the repo URL with the same function the clone used, so a
    // self-hosted origin gets a helper that actually fires — hardcoding
    // github.com here meant a GHE repo cloned fine and then failed every
    // subsequent operation.
    await execAsync(
      `git -C ${shellQuote(layout.workspace)} config user.name ${shellQuote(req.identity.name)}`,
    );
    await execAsync(
      `git -C ${shellQuote(layout.workspace)} config user.email ${shellQuote(req.identity.email)}`,
    );
    const scope = cloneCredentialScope(req.repoUrl);
    if (scope) {
      // Empty value first: it resets any helper list inherited from system or
      // global config. Git takes the FIRST helper that answers, so an inherited
      // one would authenticate the agent's pushes as something else and would be
      // handed our token by git's post-success `store`. Mirrors the `-c` pair the
      // clone uses (git_clone.ts).
      await execAsync(`git -C ${shellQuote(layout.workspace)} config credential.helper ""`);
      await execAsync(
        `git -C ${shellQuote(layout.workspace)} config ${shellQuote(`credential.${scope}.helper`)} ${shellQuote(layout.helperBin)}`,
      );
    }
  } finally {
    await fs.promises.rm(stageDir, { recursive: true, force: true });
  }

  return layout;
}
