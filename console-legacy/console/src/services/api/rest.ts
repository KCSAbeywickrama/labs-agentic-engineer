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
 * REST API client that talks to the Go backend.
 *
 * All operations go through the real backend.
 */

import type {
  Project,
  RequirementsBundle,
  CollabSession,
  Design,
  DesignBundle,
  ComponentDefinition,
  ComponentOpenAPI,
  CreateProjectInput,
  Build,
  BuildLogs,
  Deployment,
  ComponentConfig,
  EnvVar,
  ProjectStatus,
  ArtifactVersion,
  Organization,
  TaskView,
  TaskDetail,
  TaskProgressResponse,
  ProjectBuildResponse,
  ProjectBuildStatus,
  TagList,
} from './types';

import { env } from '../../config/env';

const BASE = env.VITE_CORE_API_BASE_URL;

export class ApiError extends Error {
  status: number;
  /** Machine error code from the response envelope (e.g. `plan_in_progress`), when present. */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

// Token accessor — set by App.tsx after auth, called on every request
let _getAccessToken: (() => Promise<string>) | null = null;

export function setTokenAccessor(fn: (() => Promise<string>) | null): void {
  _getAccessToken = fn;
}

export async function getToken(): Promise<string> {
  if (!_getAccessToken) return '';
  return _getAccessToken();
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };

  if (_getAccessToken) {
    const token = await _getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      // Two error shapes coexist during the Huma migration:
      //  - RFC 9457 problem+json (code-first Huma routes):
      //      { title, status, detail, errors: [{ message, location }] }
      //  - legacy envelope (remaining SSE / S2S routes): { error, message }
      // Prefer the human-readable field of whichever is present.
      message = parsed.detail || parsed.message || parsed.title || parsed.error || body;
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        const details = parsed.errors
          .map((e: { message?: string; location?: string }) =>
            e.location ? `${e.location}: ${e.message ?? ''}` : e.message)
          .filter(Boolean)
          .join('; ');
        if (details) message = message ? `${message} (${details})` : details;
      }
    } catch { /* use raw body */ }
    throw new ApiError(res.status, message);
  }
  // 204 (hold/unhold) and 202 (execute — async accept) carry no body.
  if (res.status === 204 || res.status === 202) return undefined as T;
  return res.json();
}

/**
 * Map backend Project model → frontend Project type.
 */
function mapProject(raw: any): Project {
  return {
    id: raw.name,
    name: raw.displayName || raw.name,
    prompt: raw.description || '',
    phase: 'spec',
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.createdAt || new Date().toISOString(),
  };
}

function mapComponent(raw: any): ComponentDefinition {
  return {
    id: raw.name,
    projectId: raw.projectName || '',
    name: raw.displayName || raw.name,
    techStack: raw.type || '',
    responsibilities: raw.description || '',
    apiBoundaries: '',
    interactions: '',
    status: 'created',
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.createdAt || new Date().toISOString(),
  };
}

// The active org is derived from the verified JWT server-side — there is no
// {orgHandle} path segment any more.
function orgPrefix(): string {
  return `/api/v1`;
}

function projectPrefix(projectName: string): string {
  return `/api/v1/projects/${projectName}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s_]+/g, '-')      // spaces and underscores → hyphens
    .replace(/[^a-z0-9-]/g, '')   // strip non-RFC-1123 chars
    .replace(/-+/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '');       // trim leading/trailing hyphens
}

// The contract types `dependsOn`/`attention`/`executions` as nullable; coerce
// to the always-present shapes the UI reads so callers never null-guard them.
function normalizeTaskView<T extends TaskView>(raw: T): T {
  return {
    ...raw,
    dependsOn: raw.dependsOn ?? [],
    attention: raw.attention ?? [],
    executions: raw.executions ?? {},
  };
}

export const restApi = {
  // -- Organizations (real backend) ------------------------------------------
  //
  // The BFF is read-only over OC namespaces. Org creation is an out-of-band
  // onboarding flow (Thunder signup → platform-api-service in hosted;
  // seed-admin-org.sh in local). See
  // aep-service/controllers/organization_controller.go.

  async listOrganizations(): Promise<Organization[]> {
    try {
      const data = await fetchJSON<{ items: Organization[] }>(`/api/v1/organizations`);
      return data.items || [];
    } catch {
      return [];
    }
  },

  // -- Projects (real backend) -----------------------------------------------

  async listProjects(): Promise<Project[]> {
    try {
      const data = await fetchJSON<{ items: any[] }>(`${orgPrefix()}/projects`);
      return (data.items || []).map(mapProject);
    } catch {
      return [];
    }
  },

  async getProject(projectId: string): Promise<Project | undefined> {
    try {
      const raw = await fetchJSON<any>(`${orgPrefix()}/projects/${projectId}`);
      return mapProject(raw);
    } catch {
      return undefined;
    }
  },

  async createProject(input: CreateProjectInput): Promise<Project> {
    const raw = await fetchJSON<any>(`${orgPrefix()}/projects`, {
      method: 'POST',
      body: JSON.stringify({
        name: slugify(input.name),
        displayName: input.name,
        description: input.prompt || '',
        deploymentPipeline: 'default',
      }),
    });
    return mapProject(raw);
  },

  async deleteProject(projectId: string): Promise<void> {
    await fetchJSON<void>(`${orgPrefix()}/projects/${projectId}`, { method: 'DELETE' });
  },

  async getProjectStatus(projectId: string): Promise<ProjectStatus | undefined> {
    try {
      return await fetchJSON<ProjectStatus>(`${projectPrefix(projectId)}/status`);
    } catch {
      return undefined;
    }
  },

  // -- Components (real backend) ---------------------------------------------

  async listComponents(projectId: string): Promise<ComponentDefinition[]> {
    try {
      const data = await fetchJSON<{ items: any[] }>(`${projectPrefix(projectId)}/components`);
      return (data.items || []).map(mapComponent);
    } catch {
      return [];
    }
  },

  async getComponent(projectId: string, componentId: string): Promise<ComponentDefinition | undefined> {
    try {
      const raw = await fetchJSON<any>(`${projectPrefix(projectId)}/components/${componentId}`);
      return mapComponent(raw);
    } catch {
      return undefined;
    }
  },

  // -- Requirements (multi-file directory under specs/requirements/) -------

  async getRequirements(projectId: string): Promise<RequirementsBundle | undefined> {
    try {
      const data = await fetchJSON<RequirementsBundle | null>(
        `${projectPrefix(projectId)}/requirements`,
      );
      return data ?? undefined;
    } catch {
      return undefined;
    }
  },

  // saveRequirements is GONE: the Save button only commits (files/apply);
  // version tags are cut by buildProject (single-tag build flow).

  async discardRequirements(projectId: string): Promise<RequirementsBundle | undefined> {
    try {
      return await fetchJSON<RequirementsBundle>(
        `${projectPrefix(projectId)}/requirements/discard`,
        { method: 'POST' },
      );
    } catch {
      return undefined;
    }
  },

  async listRequirementsVersions(projectId: string): Promise<ArtifactVersion[]> {
    try {
      return await fetchJSON<ArtifactVersion[]>(
        `${projectPrefix(projectId)}/requirements/versions`,
      );
    } catch {
      return [];
    }
  },

  async getRequirementsAtVersion(
    projectId: string,
    tag: string,
  ): Promise<RequirementsBundle | undefined> {
    try {
      return await fetchJSON<RequirementsBundle>(
        `${projectPrefix(projectId)}/requirements/versions/${encodeURIComponent(tag)}`,
      );
    } catch {
      return undefined;
    }
  },

  // -- Collaboration (the unified spec editor session) -----------------------
  async getCollabSession(projectId: string): Promise<CollabSession | undefined> {
    try {
      return await fetchJSON<CollabSession>(
        `${projectPrefix(projectId)}/spec/collab-session`,
      );
    } catch {
      return undefined;
    }
  },

  // -- Designs (real backend) ------------------------------------------------

  // saveAndProceedDesign is GONE: the Build button commits (files/apply) and
  // calls buildProject, which validates the whole spec and cuts the one tag.

  async discardDesignChanges(projectId: string): Promise<Design | undefined> {
    try {
      return await fetchJSON<Design>(`${projectPrefix(projectId)}/design/discard`, {
        method: 'POST',
      });
    } catch {
      return undefined;
    }
  },

  // -- Design (multi-file bundle view) ---------------------------------------

  async getDesignBundle(
    projectId: string,
  ): Promise<DesignBundle | undefined> {
    try {
      return await fetchJSON<DesignBundle>(
        `${projectPrefix(projectId)}/design/bundle`,
      );
    } catch {
      return undefined;
    }
  },

  async getDesignBundleAtVersion(
    projectId: string,
    tag: string,
  ): Promise<DesignBundle | undefined> {
    try {
      return await fetchJSON<DesignBundle>(
        `${projectPrefix(projectId)}/design/versions/${encodeURIComponent(tag)}/bundle`,
      );
    } catch {
      return undefined;
    }
  },

  // -- Builds (WorkflowRuns) --------------------------------------------------

  async triggerBuild(projectId: string, componentId: string): Promise<Build | undefined> {
    try {
      return await fetchJSON<Build>(`${projectPrefix(projectId)}/components/${componentId}/builds`, {
        method: 'POST',
      });
    } catch {
      return undefined;
    }
  },

  async listBuilds(projectId: string, componentId: string): Promise<Build[]> {
    try {
      const data = await fetchJSON<{ items: Build[] }>(`${projectPrefix(projectId)}/components/${componentId}/builds`);
      return data.items || [];
    } catch {
      return [];
    }
  },

  async getBuildLogs(projectId: string, componentId: string, buildName: string): Promise<BuildLogs | undefined> {
    try {
      return await fetchJSON<BuildLogs>(
        `${projectPrefix(projectId)}/components/${componentId}/builds/${buildName}/logs`
      );
    } catch {
      return undefined;
    }
  },

  // -- Deployments (ReleaseBindings) ------------------------------------------
  // No POST: deploys are driven entirely by OC's Component controller
  // (AutoDeploy=true) once the build's generate-workload-cr step posts the
  // Workload CR. The deploy page only reads.

  async listDeployments(projectId: string, componentId: string): Promise<Deployment[]> {
    try {
      const data = await fetchJSON<{ items: Deployment[] }>(`${projectPrefix(projectId)}/components/${componentId}/deployments`);
      return data.items || [];
    } catch {
      return [];
    }
  },

  // -- OpenAPI (Test tab) -----------------------------------------------------
  // 200  → ComponentOpenAPI (spec is a YAML string)
  // 409  → { error: 'not-service', componentType }  — exists but isn't a service
  // 404  → { error: 'not-found' }                   — design.json missing or no match

  async getComponentOpenAPI(
    projectId: string,
    componentId: string,
  ): Promise<
    | ComponentOpenAPI
    | { error: 'not-service'; componentType: string }
    | { error: 'not-found' }
  > {
    try {
      return await fetchJSON<ComponentOpenAPI>(
        `${projectPrefix(projectId)}/components/${componentId}/openapi`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The 409 body is the same envelope, just without a spec.
        try {
          const parsed = JSON.parse(e.message) as Partial<ComponentOpenAPI>;
          return { error: 'not-service', componentType: parsed.componentType || 'unknown' };
        } catch {
          return { error: 'not-service', componentType: 'unknown' };
        }
      }
      return { error: 'not-found' };
    }
  },

  // -- Tasks (GitHub-native issues ⋈ executions) -------------------------------
  //
  // Plan generation is a raw-StreamPart SSE handled in `./plan.ts` (the BFF taps
  // the stream to create/update issues; the FE renders the tool frames live).
  // Reads here are live GitHub ⋈ executions — no cache, no board.

  /** List a project's Tasks. `state` filters open/closed/all (default open). */
  async listTasks(projectId: string, state?: 'open' | 'closed' | 'all'): Promise<TaskView[]> {
    const q = state ? `?state=${state}` : '';
    try {
      const data = await fetchJSON<TaskView[] | null>(`${projectPrefix(projectId)}/tasks${q}`);
      return (data ?? []).map(normalizeTaskView);
    } catch {
      return [];
    }
  },

  /** One Task with its full Execution history, keyed by GitHub issue number. */
  async getTask(projectId: string, issueNumber: number): Promise<TaskDetail> {
    const data = await fetchJSON<TaskDetail>(`${projectPrefix(projectId)}/tasks/${issueNumber}`);
    return {
      ...normalizeTaskView(data),
      executionHistory: data.executionHistory ?? [],
    };
  },

  // Execute stamps `aep:execute`; the funnel does the rest (doubles as retry).
  // 202 on success. Lets ApiError bubble so callers can surface the server's
  // message for a 409 (issue closed) or an already-active no-op.
  async executeTask(projectId: string, issueNumber: number): Promise<void> {
    await fetchJSON<void>(`${projectPrefix(projectId)}/tasks/${issueNumber}/execute`, {
      method: 'POST',
    });
  },

  // Hold / unhold toggle the level-triggered `aep:hold` label (idempotent, 204).
  async holdTask(projectId: string, issueNumber: number): Promise<void> {
    await fetchJSON<void>(`${projectPrefix(projectId)}/tasks/${issueNumber}/hold`, {
      method: 'POST',
    });
  },

  async unholdTask(projectId: string, issueNumber: number): Promise<void> {
    await fetchJSON<void>(`${projectPrefix(projectId)}/tasks/${issueNumber}/hold`, {
      method: 'DELETE',
    });
  },

  // Unified execution progress feed keyed by execution id (kind selects the
  // source server-side). Same cursor/NDJSON contract as the legacy per-task
  // progress endpoints, so `useCursorPolling` drives it unchanged.
  // The Task log feed. `executionId` pins one execution from the history
  // browser; omitted, the server reads the Task's most recent execution.
  async getExecutionProgress(
    projectId: string, issueNumber: number, sinceMillis: number, executionId?: string,
  ): Promise<TaskProgressResponse> {
    const q = new URLSearchParams({ sinceMillis: String(sinceMillis) });
    if (executionId) q.set('executionId', executionId);
    return fetchJSON<TaskProgressResponse>(
      `${projectPrefix(projectId)}/tasks/${issueNumber}/log?${q.toString()}`,
    );
  },

  // -- Component Configs (Environment Variables) --------------------------------

  async getComponentConfig(
    projectId: string, componentId: string,
  ): Promise<ComponentConfig | undefined> {
    try {
      const data = await fetchJSON<ComponentConfig | null>(
        `${projectPrefix(projectId)}/components/${componentId}/configs`,
      );
      return data ?? undefined;
    } catch {
      return undefined;
    }
  },

  async updateComponentConfig(
    projectId: string, componentId: string, envVars: EnvVar[],
  ): Promise<ComponentConfig | undefined> {
    try {
      return await fetchJSON<ComponentConfig>(
        `${projectPrefix(projectId)}/components/${componentId}/configs`,
        {
          method: 'PUT',
          body: JSON.stringify({ envVars }),
        },
      );
    } catch {
      return undefined;
    }
  },

  // -- Project build (single-tag spec version + dev workflow) -------------------

  // Trigger a build: the backend validates the whole spec (requirements +
  // design), cuts the next v<N> tag, starts the dev workflow asynchronously,
  // and returns the tag. 422 (ApiError with per-file detail) when the spec is
  // not buildable — let it bubble so the Build button can surface it.
  async buildProject(projectId: string): Promise<ProjectBuildResponse> {
    return fetchJSON<ProjectBuildResponse>(`${projectPrefix(projectId)}/build`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // Live status of the build for a spec version tag. 404 → no build for it.
  async getProjectBuild(projectId: string, tag: string): Promise<ProjectBuildStatus> {
    return fetchJSON<ProjectBuildStatus>(
      `${projectPrefix(projectId)}/build/${encodeURIComponent(tag)}`,
    );
  },

  // The spec version tags (v<N>, newest first) + latest + dirty flag.
  async listProjectTags(projectId: string): Promise<TagList | undefined> {
    try {
      return await fetchJSON<TagList>(`${projectPrefix(projectId)}/tags`);
    } catch {
      return undefined;
    }
  },

};
