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

// Scenario switch for the Settings (#96) and Onboarding (#102) features.
// Toggle in devtools:
//   localStorage.setItem('aep:mock:settings',
//     'empty' | 'partial' | 'connected' | 'error' | 'sync-error')
// "empty": nothing connected yet (the default — triggers the onboarding
// gate; also exercises Settings' not-connected states).
// "partial": GitHub connected, Anthropic not — the onboarding wizard opens
// at its first incomplete step (resume-after-abandon, #102).
// "connected": GitHub + Anthropic already connected (no onboarding).
// "error": GET /config and GET /skills fail (load-error state).
// "sync-error": config empty and POST /skills/sync fails — exercises the
// wizard's bootstrap-failure step (Retry / Continue anyway, #102).
export type SettingsScenario =
  | "empty"
  | "partial"
  | "connected"
  | "error"
  | "sync-error";

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

// Bootstrap failure for the onboarding wizard (#102): repo creation or the
// built-ins push failed. Sync is idempotent, so the remedy is retry.
export const skillsSyncError: ErrorModel = {
  type: "about:blank",
  status: 502,
  title: "Bad Gateway",
  detail: "Failed to create the skills repository on GitHub",
};

// Covers all four kinds (org | platform | custom | imported — the BE's real
// vocabulary; builtin/flow are retired) so the catalogue's grouped rendering,
// read-only vs editable actions, and the updates-available list all exercise.
export const seedSkills: SkillDetailBody[] = [
  {
    orgId: "org-1",
    name: "go",
    kind: "org",
    editable: false,
    description:
      "How to build a Go service on the platform — layout, port 9090, multi-stage Dockerfile.",
    skillMd: `---
name: go
description: How to build a Go service on the platform.
---

# Go services

Pin \`golang:1.25-alpine\` as the builder; the build pod runs with
\`GOTOOLCHAIN=local\`.

## Layout

- \`cmd/\` — entrypoints
- \`internal/\` — everything else

Expose \`GET /health\` for liveness on port **9090**.`,
    references: {},
    contentSha: "sha-go-1",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "react-webapp",
    kind: "org",
    editable: false,
    description:
      "How to build a React SPA on the platform — Vite layout, nginx runtime, window._env_ config.",
    skillMd: `---
name: react-webapp
description: How to build a React SPA on the platform.
---

# React web apps

Load \`/env-config.js\` synchronously **before** the bundle, then read runtime
config from \`window._env_\`. Throw on a missing key rather than defaulting.`,
    references: {},
    contentSha: "sha-rw-1",
    updatedAt: "2026-05-02T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "high-level-architecture",
    kind: "platform",
    editable: false,
    description: "Derives component architecture from requirements.",
    skillMd: `---
name: high-level-architecture
description: Derives component architecture from requirements.
---

Derive the component architecture from the approved requirements.`,
    references: {},
    contentSha: "sha-hla-1",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "task-breakdown",
    kind: "platform",
    editable: false,
    description: "Breaks a design into buildable tasks.",
    skillMd: `---
name: task-breakdown
description: Breaks a design into buildable tasks.
---

Break the approved design into a sequence of buildable tasks.`,
    references: {},
    contentSha: "sha-tb-1",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "acme-deploy-checklist",
    kind: "custom",
    editable: true,
    description: "Acme's internal pre-deploy checklist.",
    skillMd: `---
name: acme-deploy-checklist
description: Acme's internal pre-deploy checklist.
---

# Pre-deploy checklist

1. Migrations applied
2. Feature flags reviewed
3. Rollback plan written`,
    references: {
      "references/rollback.md": "# Rollback\n\nRevert the release tag.",
    },
    contentSha: "sha-adc-1",
    updatedAt: "2026-06-20T00:00:00Z",
  },
  {
    orgId: "org-1",
    name: "find-skills",
    kind: "imported",
    editable: true,
    description: "Discover and evaluate community AgentSkills before adopting.",
    skillMd: `---
name: find-skills
description: Discover and evaluate community AgentSkills before adopting.
---

Search the registry, read the SKILL.md, and check the declared license.`,
    references: {},
    contentSha: "sha-fs-1",
    updatedAt: "2026-07-01T00:00:00Z",
  },
];

// Embedded content differs from the org repo copy — surfaces in GET
// /skills/updates until synced. "code-review" is absent from the repo.
export const seedSkillUpdates: SkillUpdate[] = [
  { name: "task-breakdown" },
  { name: "go" },
  { name: "code-review" },
];
