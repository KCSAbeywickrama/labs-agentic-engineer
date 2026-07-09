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

import type { components } from "../../generated/aep-api";

type GitProviderProjection = components["schemas"]["GitProviderProjection"];
type LLMProjection = components["schemas"]["LLMProjection"];
type SkillDetailBody = components["schemas"]["SkillDetailBody"];
type SkillUpdate = components["schemas"]["SkillUpdate"];
type ErrorModel = components["schemas"]["ErrorModel"];

// Scenario switch for the Settings feature (#96). Toggle in devtools:
//   localStorage.setItem('aep:mock:settings', 'empty' | 'connected' | 'error')
// "empty": nothing connected yet (the default — exercises the not-connected
// and GitHub-not-connected-blocks-Skills states).
// "connected": GitHub + Anthropic already connected.
// "error": GET /config and GET /skills fail (load-error state).
export type SettingsScenario = "empty" | "connected" | "error";

// Typing this exact value into a PAT/API-key field simulates the BFF's
// synchronous probe-before-persist validation failing against the real
// provider (issue #96: PATCH /config validates before persisting).
export const INVALID_CREDENTIAL_VALUE = "invalid";

// Import sentinels (issue #96 re-grill: reject hard, warn soft). A file name
// or URL containing "invalid" simulates a structurally-broken skill (hard
// 422, nothing persisted); containing "warn" simulates an importable-but-
// imperfect skill (201 with a non-empty ImportResult.warnings).
export const IMPORT_INVALID_SENTINEL = "invalid";
export const IMPORT_WARN_SENTINEL = "warn";

export const importWarningsFixture = [
  "license: none declared — treated as unlicensed",
  "compatibility: references a tool ('browser') this platform does not provide",
];

// HTML URL of the org skills repo backing the catalogue (GET /skills
// envelope repoUrl — powers the Import dialog's via-pull-request guidance).
export const skillsRepoUrl = "https://github.com/acme-dev/org-skills";

export const importUrlInvalidError: ErrorModel = {
  type: "about:blank",
  status: 422,
  title: "Unprocessable Entity",
  detail:
    "body.url: the URL did not yield a valid skill (expected a raw SKILL.md or a gzip AgentSkills tarball)",
};

export const importFileInvalidError: ErrorModel = {
  type: "about:blank",
  status: 422,
  title: "Unprocessable Entity",
  detail: "body.file: not a valid gzip AgentSkills tarball",
};

export const githubConnectedFixture: GitProviderProjection = {
  kind: "github",
  mode: "pat",
  status: "connected",
  githubLogin: "acme-dev",
  identityLogin: "acme-dev",
  identityName: "Acme Dev",
  identityEmail: "dev@acme.example",
  connectedAt: "2026-06-01T12:00:00Z",
  lastValidatedAt: "2026-07-01T09:00:00Z",
  selectedRepos: ["acme-dev/demo-shop"],
};

export const llmConnectedFixture: LLMProjection = {
  kind: "anthropic",
  status: "connected",
  keyPrefix: "sk-ant-",
  keyLast4: "wxyz",
  connectedAt: "2026-06-01T12:05:00Z",
  lastValidatedAt: "2026-07-01T09:00:00Z",
};

export const gitProviderValidationError: ErrorModel = {
  type: "about:blank",
  status: 422,
  title: "Unprocessable Entity",
  detail: "body.gitProvider: the provided PAT could not be validated against GitHub",
};

export const llmValidationError: ErrorModel = {
  type: "about:blank",
  status: 422,
  title: "Unprocessable Entity",
  detail: "body.llm: the provided API key was rejected by Anthropic",
};

export const gitProviderDisconnectRejected: ErrorModel = {
  type: "about:blank",
  status: 422,
  title: "Unprocessable Entity",
  detail: "body.gitProvider: use POST /config/git-provider/disconnect to disconnect the git provider",
};

export const configLoadError: ErrorModel = {
  type: "about:blank",
  status: 500,
  title: "Internal Server Error",
  detail: "Failed to load organization configuration",
};

export const skillsLoadError: ErrorModel = {
  type: "about:blank",
  status: 500,
  title: "Internal Server Error",
  detail: "Failed to load skills",
};

// Two built-ins, one flow skill, one custom (editable) — enough spread to
// exercise editable/read-only rendering and the updates-available list.
export const seedSkills: SkillDetailBody[] = [
  {
    orgId: "org-1",
    name: "high-level-architecture",
    kind: "builtin",
    editable: false,
    description: "Derives component architecture from requirements.",
    skillMd:
      "---\nname: high-level-architecture\ndescription: Derives component architecture from requirements.\n---\n\nDerive the component architecture from the approved requirements.",
    references: {},
    contentSha: "sha-hla-1",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "task-breakdown",
    kind: "builtin",
    editable: false,
    description: "Breaks a design into buildable tasks.",
    skillMd:
      "---\nname: task-breakdown\ndescription: Breaks a design into buildable tasks.\n---\n\nBreak the approved design into a sequence of buildable tasks.",
    references: {},
    contentSha: "sha-tb-1",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "flow-orchestration",
    kind: "flow",
    editable: false,
    description: "Coordinates the multi-agent generation flow.",
    skillMd:
      "---\nname: flow-orchestration\ndescription: Coordinates the multi-agent generation flow.\n---\n\nCoordinate hand-off between the generation-flow agents.",
    references: {},
    contentSha: "sha-fo-2",
    updatedAt: "2026-05-15T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "acme-deploy-checklist",
    kind: "custom",
    editable: true,
    description: "Acme's internal pre-deploy checklist.",
    skillMd:
      "---\nname: acme-deploy-checklist\ndescription: Acme's internal pre-deploy checklist.\n---\n\nRun through Acme's pre-deploy checklist before shipping.",
    references: {},
    contentSha: "sha-adc-1",
    updatedAt: "2026-06-20T00:00:00Z",
  },
];

// Behind the platform's embedded version — surfaces in GET /skills/updates
// until synced. "code-review" has no repo row yet (repoVersion -1).
export const seedSkillUpdates: SkillUpdate[] = [
  { name: "task-breakdown", repoVersion: 1, embeddedVersion: 2 },
  { name: "code-review", repoVersion: -1, embeddedVersion: 1 },
];
