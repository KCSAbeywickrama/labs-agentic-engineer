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

import { http, HttpResponse } from "msw";
import type { components } from "../../generated/aep-api";
import {
  configLoadError,
  gitProviderDisconnectRejected,
  githubConnectedFixture,
  gitProviderValidationError,
  INVALID_CREDENTIAL_VALUE,
  llmConnectedFixture,
  llmValidationError,
  seedSkillUpdates,
  seedSkills,
  skillsLoadError,
  type SettingsScenario,
} from "../fixtures/settings";

type ConfigPatch = components["schemas"]["ConfigPatch"];
type ConfigProjection = components["schemas"]["ConfigProjection"];
type GitProviderProjection = components["schemas"]["GitProviderProjection"];
type LLMProjection = components["schemas"]["LLMProjection"];
type CreateSkillInput = components["schemas"]["CreateSkillInput"];
type UpdateSkillInput = components["schemas"]["UpdateSkillInput"];
type SkillDetailBody = components["schemas"]["SkillDetailBody"];
type SkillUpdate = components["schemas"]["SkillUpdate"];
type SkillSummary = components["schemas"]["SkillSummary"];

function scenario(): SettingsScenario {
  return (
    (localStorage.getItem("aep:mock:settings") as SettingsScenario | null) ??
    "empty"
  );
}

function problem(body: object, status: number) {
  return HttpResponse.json(body, {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

// Session-local state layered on top of the scenario baseline, mirroring
// handlers/projects.ts's createdProjects pattern.
let gitProvider: GitProviderProjection | null = null;
let llm: LLMProjection | null = null;
let skills: SkillDetailBody[] = [];
let skillUpdates: SkillUpdate[] = [];
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  if (scenario() === "connected") {
    gitProvider = { ...githubConnectedFixture };
    llm = { ...llmConnectedFixture };
  }
  skills = seedSkills.map((s) => ({ ...s }));
  skillUpdates = seedSkillUpdates.map((u) => ({ ...u }));
}

function toSummary(s: SkillDetailBody): SkillSummary {
  return {
    name: s.name,
    kind: s.kind,
    version: s.version,
    description: s.description,
    contentSha: s.contentSha,
    editable: s.editable,
  };
}

function extractDescription(skillMd: string): string {
  const match = /^description:\s*(.+)$/m.exec(skillMd);
  return match?.[1]?.trim() ?? "Custom skill";
}

function configProjection(): ConfigProjection {
  return {
    gitProvider,
    llm,
    idp: {
      kind: "platform",
      issuer: "https://idp.aep.local",
      jwksUrl: "https://idp.aep.local/.well-known/jwks.json",
      hasClientSecret: false,
      publisherClientId: "aep-console",
    },
  };
}

export const settingsHandlers = [
  http.get("*/api/v1/config", () => {
    ensureInitialized();
    if (scenario() === "error") return problem(configLoadError, 500);
    return HttpResponse.json(configProjection());
  }),

  http.patch("*/api/v1/config", async ({ request }) => {
    ensureInitialized();
    const body = (await request.json()) as ConfigPatch;

    if (body.llm !== undefined) {
      if (body.llm === null) {
        llm = null;
      } else if (body.llm.apiKey === INVALID_CREDENTIAL_VALUE) {
        return problem(llmValidationError, 422);
      } else {
        llm = {
          kind: "anthropic",
          status: "connected",
          keyPrefix: body.llm.apiKey.slice(0, 7),
          keyLast4: body.llm.apiKey.slice(-4),
          connectedAt: new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
        };
      }
    }

    if (body.gitProvider !== undefined) {
      if (body.gitProvider === null) {
        return problem(gitProviderDisconnectRejected, 422);
      }
      if (body.gitProvider.pat === INVALID_CREDENTIAL_VALUE) {
        return problem(gitProviderValidationError, 422);
      }
      const login = body.gitProvider.githubLogin || "acme-dev";
      gitProvider = {
        kind: "github",
        mode: "pat",
        status: "connected",
        githubLogin: login,
        identityLogin: login,
        identityName: "Acme Dev",
        identityEmail: "dev@acme.example",
        connectedAt: new Date().toISOString(),
        lastValidatedAt: new Date().toISOString(),
        selectedRepos: ["acme-dev/demo-shop"],
      };
    }

    return HttpResponse.json(configProjection());
  }),

  http.post("*/api/v1/config/git-provider/disconnect", () => {
    ensureInitialized();
    gitProvider = null;
    return HttpResponse.json({ status: "disconnected" });
  }),

  // Static /skills/* routes must register before the dynamic /skills/:name
  // handler below, or MSW would match "updates"/"import"/"sync" as a name.
  http.post("*/api/v1/skills/import", async () => {
    ensureInitialized();
    const imported: SkillDetailBody = {
      orgId: "org-1",
      name: `imported-skill-${skills.length + 1}`,
      kind: "imported",
      editable: true,
      description: "Imported from an AgentSkills tarball.",
      skillMd:
        "---\nname: imported-skill\ndescription: Imported from an AgentSkills tarball.\n---\n\nImported skill body.",
      references: {},
      version: 1,
      contentSha: `sha-imported-${skills.length + 1}`,
      updatedAt: new Date().toISOString(),
    };
    skills.push(imported);
    return HttpResponse.json(
      { name: imported.name, kind: imported.kind, warnings: [] },
      { status: 201 },
    );
  }),

  http.post("*/api/v1/skills/sync", async ({ request }) => {
    ensureInitialized();
    let names: string[] | undefined;
    try {
      const body = (await request.json()) as { names?: string[] } | null;
      names = body?.names ?? undefined;
    } catch {
      names = undefined;
    }
    const targets =
      names && names.length > 0
        ? skillUpdates.filter((u) => names.includes(u.name))
        : skillUpdates;

    for (const t of targets) {
      const existing = skills.find((s) => s.name === t.name);
      if (existing) {
        existing.version = t.embeddedVersion;
        existing.updatedAt = new Date().toISOString();
      } else {
        skills.push({
          orgId: "org-1",
          name: t.name,
          kind: "builtin",
          editable: false,
          description: `${t.name} (built-in)`,
          skillMd: `---\nname: ${t.name}\ndescription: ${t.name} (built-in)\n---\n\nBuilt-in skill body.`,
          references: {},
          version: t.embeddedVersion,
          contentSha: `sha-${t.name}-${t.embeddedVersion}`,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    const targetNames = new Set(targets.map((t) => t.name));
    skillUpdates = skillUpdates.filter((u) => !targetNames.has(u.name));

    return HttpResponse.json({ status: "synced", updated: targets.length });
  }),

  http.get("*/api/v1/skills/updates", () => {
    ensureInitialized();
    if (scenario() === "error") return problem(skillsLoadError, 500);
    return HttpResponse.json({ items: skillUpdates });
  }),

  http.get("*/api/v1/skills", () => {
    ensureInitialized();
    if (scenario() === "error") return problem(skillsLoadError, 500);
    return HttpResponse.json({ items: skills.map(toSummary) });
  }),

  http.post("*/api/v1/skills", async ({ request }) => {
    ensureInitialized();
    const body = (await request.json()) as CreateSkillInput;
    if (skills.some((s) => s.name === body.name)) {
      return problem(
        {
          type: "about:blank",
          status: 409,
          title: "Conflict",
          detail: `A skill named ${body.name} already exists`,
        },
        409,
      );
    }
    const created: SkillDetailBody = {
      orgId: "org-1",
      name: body.name,
      kind: "custom",
      editable: true,
      description: extractDescription(body.skillMd),
      skillMd: body.skillMd,
      references: body.references,
      version: 1,
      contentSha: `sha-${body.name}-1`,
      updatedAt: new Date().toISOString(),
    };
    skills.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get("*/api/v1/skills/:name", ({ params }) => {
    ensureInitialized();
    const skill = skills.find((s) => s.name === params.name);
    if (!skill) {
      return problem(
        {
          type: "about:blank",
          status: 404,
          title: "Not Found",
          detail: `Skill ${String(params.name)} not found`,
        },
        404,
      );
    }
    return HttpResponse.json(skill);
  }),

  http.put("*/api/v1/skills/:name", async ({ params, request }) => {
    ensureInitialized();
    const skill = skills.find((s) => s.name === params.name && s.editable);
    if (!skill) {
      return problem(
        {
          type: "about:blank",
          status: 404,
          title: "Not Found",
          detail: `Editable skill ${String(params.name)} not found`,
        },
        404,
      );
    }
    const body = (await request.json()) as UpdateSkillInput;
    skill.skillMd = body.skillMd;
    skill.references = body.references;
    skill.description = extractDescription(body.skillMd);
    skill.version += 1;
    skill.updatedAt = new Date().toISOString();
    return HttpResponse.json(skill);
  }),

  http.delete("*/api/v1/skills/:name", ({ params }) => {
    ensureInitialized();
    skills = skills.filter((s) => s.name !== params.name);
    return HttpResponse.json({ status: "deleted" });
  }),
];
