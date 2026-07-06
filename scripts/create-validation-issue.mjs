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

// Interim VALIDATION-phase task creator (see
// docs/design/validation-phase-draft-plan.md, section A3).
//
// Reads `specs/validation/validation-criteria.json` from a project repo
// (authored there by the spec agent's `validation-criteria` skill) and
// creates the GitHub validation issue the coding agent will be dispatched
// against. Stands in for the platform trigger + issue builder until that
// lands in aep-api (tech-lead-style generation may replace the rendering
// later).
//
// Usage:
//   node scripts/create-validation-issue.mjs            # create the issue
//   node scripts/create-validation-issue.mjs --dry-run  # print body only
//
// Requires an authenticated `gh` CLI.

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants — replace with the real project repo (expected structure:
// specs/validation/validation-criteria.json committed, specs/design/** for
// component design docs).
// ---------------------------------------------------------------------------

const REPO = "OWNER/PROJECT-REPO"; // TODO: replace with the real project repo
const CRITERIA_PATH = "specs/validation/validation-criteria.json";
const LABELS = ["aep", "validation"];

// Deployed endpoint URL per component, keyed by component name. Filled by
// hand for now; the platform resolves these from OpenChoreo ReleaseBindings
// once the trigger moves into aep-api.
const DEPLOYED_ENDPOINTS = {
  // "task-webapp": "https://task-webapp.example.dev",
  // "task-api": "https://task-api.example.dev",
};

// ---------------------------------------------------------------------------

const METHODS = new Set(["e2e", "scenario", "manual"]);

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  });
}

function fetchCriteria() {
  const raw = gh([
    "api",
    `repos/${REPO}/contents/${CRITERIA_PATH}`,
    "-H",
    "Accept: application/vnd.github.raw",
  ]);
  return JSON.parse(raw);
}

// Structural validation mirroring skills/validation-criteria/SKILL.md. The
// oracle drives everything downstream, so a malformed file fails loudly here.
function validateCriteria(doc) {
  const fail = (msg) => {
    throw new Error(`validation-criteria.json invalid: ${msg}`);
  };
  if (!Array.isArray(doc.requirements) || doc.requirements.length === 0) {
    fail("requirements must be a non-empty array");
  }
  for (const req of doc.requirements) {
    if (!/^REQ-\d{3}$/.test(req.id ?? "")) fail(`bad requirement id ${JSON.stringify(req.id)}`);
    if (!req.statement) fail(`requirement ${req.id} has no statement`);
    if (!Array.isArray(req.criteria) || req.criteria.length === 0) {
      fail(`requirement ${req.id} has no criteria`);
    }
    for (const c of req.criteria) {
      if (!/^AC-\d{3}-[a-z]+$/.test(c.id ?? "")) fail(`bad criterion id ${JSON.stringify(c.id)} under ${req.id}`);
      if (!c.must) fail(`criterion ${c.id} has no must`);
      if (!METHODS.has(c.method)) fail(`criterion ${c.id} has unknown method ${JSON.stringify(c.method)}`);
    }
  }
}

function summarize(doc) {
  const sum = { e2e: 0, e2eCovered: 0, scenario: 0, manual: 0 };
  for (const req of doc.requirements) {
    for (const c of req.criteria) {
      if (c.method === "e2e") {
        sum.e2e++;
        if (c.covered === true) sum.e2eCovered++;
      } else sum[c.method]++;
    }
  }
  return sum;
}

// issueNumber is 0 at creation time; the body is re-rendered and edited once
// the number exists — same two-step the implementation-task flow uses.
function renderBody(doc, issueNumber) {
  const sum = summarize(doc);
  const lines = [];

  lines.push(
    "Validate the deployed system against its acceptance criteria: author end-to-end tests, run them against the deployed endpoints below, and open a PR containing the tests and a validation report.",
    "",
    "## Acceptance oracle",
    `The source of truth is \`${CRITERIA_PATH}\` in this repo. Do not edit it except to set \`covered: true\` on e2e criteria whose spec passes.`,
    "",
    `- \`e2e\` — ${sum.e2e} criteria (${sum.e2eCovered} already covered by committed specs; run those as regression, author specs only for the rest).`,
    `- \`manual\` — ${sum.manual} criteria: render as an unchecked human checklist in the report.`,
    `- \`scenario\` — ${sum.scenario} criteria: out of scope for automation in this run; list as not-yet-validated in the report.`,
    ""
  );

  for (const req of doc.requirements) {
    lines.push(`### ${req.id} — ${req.statement}`, "", "| Criterion | Method | Covered | Must |", "|---|---|---|---|");
    for (const c of req.criteria) {
      const covered = c.method === "e2e" ? (c.covered === true ? "yes" : "no") : "—";
      lines.push(`| ${c.id} | ${c.method} | ${covered} | ${c.must.replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }

  lines.push("## Deployed endpoints");
  const entries = Object.entries(DEPLOYED_ENDPOINTS);
  if (entries.length === 0) {
    lines.push("_Not resolved yet — fill `DEPLOYED_ENDPOINTS` in scripts/create-validation-issue.mjs before dispatching the agent._");
  } else {
    lines.push("| Component | URL |", "|---|---|");
    for (const [name, url] of entries) lines.push(`| ${name} | ${url} |`);
  }
  lines.push(
    "",
    "Per-component design docs: `specs/design/components/<name>/design.md` (OpenAPI contract, when present, alongside as `openapi.yaml`); system overview: `specs/design/design.md`.",
    "",
    "## Test layout",
    "- Playwright package at repo root `tests/e2e/` (own `package.json`; do not touch application source under any component app path).",
    "- One spec file per criterion: `tests/e2e/specs/<AC-ID>.spec.ts`; test title MUST start with `<AC-ID>: ` — that prefix is the join key for the report.",
    "- UI criteria: browser specs (`@playwright/test`). API criteria: the built-in `request` fixture. Explore with `playwright-cli` first; never commit exploration sessions.",
    "",
    "## Report",
    "- Commit `specs/validation/report.md` (summary, per-criterion results, manual checklist, scenario not-yet-validated list) and `specs/validation/report.json`.",
    "- Set `covered: true` in the criteria file for each e2e criterion whose spec passes.",
    "- Post a summary comment on this issue when done.",
    "",
    "---",
    `When you open the PR, include \`Closes #${issueNumber}\` in its body so the platform links the PR back to this task. One PR; tests and report only.`
  );

  return lines.join("\n");
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const doc = fetchCriteria();
  validateCriteria(doc);

  if (dryRun) {
    console.log(renderBody(doc, 0));
    return;
  }

  const title = `Validate ${REPO.split("/")[1]} against its acceptance criteria`;
  for (const label of LABELS) {
    // Idempotent: --force updates the label if it already exists.
    gh(["label", "create", label, "--repo", REPO, "--force"]);
  }
  const url = gh(
    ["issue", "create", "--repo", REPO, "--title", title, "--label", LABELS.join(","), "--body-file", "-"],
    renderBody(doc, 0)
  ).trim();
  const issueNumber = Number(url.split("/").pop());

  // Second pass: inject the real issue number into the Closes footer.
  gh(["issue", "edit", String(issueNumber), "--repo", REPO, "--body-file", "-"], renderBody(doc, issueNumber));

  console.log(url);
}

main();
