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
  ComponentTask,
  ComponentConfig,
  EnvVar,
  ProjectStatus,
  ArtifactVersion,
  Tasks,
  Organization,
  ProjectBoard,
  TaskStatusResponse,
  TaskProgressResponse,
} from './types';

import { env } from '../../config/env';

const BASE = env.VITE_CORE_API_BASE_URL;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
  if (res.status === 204) return undefined as T;
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

  async saveRequirements(projectId: string): Promise<RequirementsBundle | undefined> {
    try {
      return await fetchJSON<RequirementsBundle>(
        `${projectPrefix(projectId)}/requirements/save`,
        { method: 'POST' },
      );
    } catch {
      return undefined;
    }
  },

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

  // -- Collaboration (still scoped to the requirements editor session) ------
  async getCollabSession(projectId: string): Promise<CollabSession | undefined> {
    try {
      return await fetchJSON<CollabSession>(
        `${projectPrefix(projectId)}/requirements/collab-session`,
      );
    } catch {
      return undefined;
    }
  },

  // -- Designs (real backend) ------------------------------------------------

  async getDesign(projectId: string): Promise<Design | undefined> {
    try {
      const data = await fetchJSON<Design | null>(`${projectPrefix(projectId)}/design`);
      return data ?? undefined;
    } catch {
      return undefined;
    }
  },

  async saveAndProceedDesign(projectId: string): Promise<Design> {
    // Let ApiError bubble — Publish needs to surface the server's error
    // message (e.g. missing requirements baseline, save-via-API failures)
    // rather than collapsing every failure into a generic toast.
    return fetchJSON<Design>(`${projectPrefix(projectId)}/design/save`, {
      method: 'POST',
    });
  },

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

  // -- Tasks (implementation agents) -------------------------------------------

  async dispatchTasks(projectId: string): Promise<any[]> {
    return await fetchJSON<any[]>(`${projectPrefix(projectId)}/tasks/dispatch`, {
      method: 'POST',
    });
  },

  /**
   * Streams task generation as SSE. The two-phase tech-lead agent emits:
   *   data-plan-item            — { tempId, componentName, title, rationale, dependsOn }
   *   data-plan-complete        — { items[] }
   *   data-task-issued          — { tempId, taskId, issueUrl, issueNumber }
   *   data-task-issue-failed    — { tempId, errorText }
   *   data-task-body-delta      — { taskId, delta }
   *   data-task-body-complete   — { taskId, body }
   *   data-task-rejected        — { taskId, reason }
   *   data-finish               — { batchId, taskCount }
   *   error                     — { scope: 'plan'|'detail', errorText, taskId?, tempId?, issues? }
   *
   * Resolves to true when the stream completed successfully (no error frames).
   */
  async streamGenerateTasks(
    projectId: string,
    handlers: {
      onPlanItem?: (item: {
        tempId: string;
        componentName: string;
        title: string;
        rationale: string;
        dependsOn: string[];
      }) => void;
      onPlanComplete?: (items: unknown[]) => void;
      onTaskIssued?: (e: {
        tempId: string;
        taskId: string;
        issueUrl: string;
        issueNumber: number;
      }) => void;
      onTaskIssueFailed?: (e: { tempId: string; errorText: string }) => void;
      onTaskBodyDelta?: (e: { taskId: string; delta: string }) => void;
      onTaskBodyComplete?: (e: { taskId: string; body: string }) => void;
      onTaskRejected?: (e: { taskId: string; reason: string }) => void;
      onError?: (e: {
        scope?: string;
        errorText?: string;
        tempId?: string;
        taskId?: string;
        issues?: unknown;
      }) => void;
      onFinish?: (e: { batchId?: string; taskCount?: number }) => void;
    },
    signal?: AbortSignal,
  ): Promise<boolean> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (_getAccessToken) {
      const token = await _getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(
      `${BASE}${projectPrefix(projectId)}/tasks/generate`,
      { method: 'POST', headers, body: '{}', signal },
    );
    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let errored = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const data = chunk.data ?? {};
            switch (chunk.type) {
              case 'data-plan-item':
                handlers.onPlanItem?.(data);
                break;
              case 'data-plan-complete':
                handlers.onPlanComplete?.(data.items ?? []);
                break;
              case 'data-task-issued':
                handlers.onTaskIssued?.(data);
                break;
              case 'data-task-issue-failed':
                handlers.onTaskIssueFailed?.(data);
                break;
              case 'data-task-body-delta':
                handlers.onTaskBodyDelta?.(data);
                break;
              case 'data-task-body-complete':
                handlers.onTaskBodyComplete?.(data);
                break;
              case 'data-task-rejected':
                handlers.onTaskRejected?.(data);
                break;
              case 'data-finish':
                handlers.onFinish?.(data);
                break;
              case 'error':
                errored = true;
                handlers.onError?.(data);
                break;
            }
          } catch {
            // ignore non-JSON data line
          }
        }
      }
    }
    return !errored;
  },

  async regenerateTaskBody(
    projectId: string,
    taskId: string,
    handlers: {
      onTaskBodyDelta?: (e: { taskId: string; delta: string }) => void;
      onTaskBodyComplete?: (e: { taskId: string; body: string }) => void;
      onError?: (e: { errorText?: string }) => void;
      onFinish?: () => void;
    },
    signal?: AbortSignal,
  ): Promise<boolean> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (_getAccessToken) {
      const token = await _getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(
      `${BASE}${projectPrefix(projectId)}/tasks/${taskId}/regenerate-body`,
      { method: 'POST', headers, body: '{}', signal },
    );
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let errored = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const data = chunk.data ?? {};
            switch (chunk.type) {
              case 'data-task-body-delta':
                handlers.onTaskBodyDelta?.(data);
                break;
              case 'data-task-body-complete':
                handlers.onTaskBodyComplete?.(data);
                break;
              case 'data-finish':
                handlers.onFinish?.();
                break;
              case 'error':
                errored = true;
                handlers.onError?.(data);
                break;
            }
          } catch {
            // ignore
          }
        }
      }
    }
    return !errored;
  },

  async getTasks(projectId: string): Promise<Tasks | undefined> {
    try {
      const data = await fetchJSON<Tasks | null>(`${projectPrefix(projectId)}/tasks/generated`);
      return data ?? undefined;
    } catch {
      return undefined;
    }
  },

  async getProjectBoard(projectId: string): Promise<ProjectBoard> {
    const empty: ProjectBoard = { todo: [], inProgress: [], done: [], onHold: [], failed: [], url: '' };
    try {
      const data = await fetchJSON<ProjectBoard>(`${projectPrefix(projectId)}/board`);
      return data ?? empty;
    } catch {
      return empty;
    }
  },

  async listTasks(projectId: string): Promise<ComponentTask[]> {
    try {
      return await fetchJSON<ComponentTask[]>(`${projectPrefix(projectId)}/tasks`);
    } catch {
      return [];
    }
  },

  // Operator-driven retry for a `failed` task. Re-dispatches a fresh
  // WorkflowRun against the same component / issue / branch with a newly
  // minted per-task bearer.
  async retryTask(projectId: string, taskId: string): Promise<void> {
    await fetchJSON<void>(`${projectPrefix(projectId)}/tasks/${taskId}/retry`, {
      method: 'POST',
    });
  },

  async getTask(projectId: string, taskId: string): Promise<ComponentTask> {
    return fetchJSON<ComponentTask>(`${projectPrefix(projectId)}/tasks/${taskId}`);
  },

  async getTaskStatus(projectId: string, taskId: string): Promise<TaskStatusResponse> {
    return fetchJSON<TaskStatusResponse>(`${projectPrefix(projectId)}/tasks/${taskId}/status`);
  },

  async getTaskAgentProgress(
    projectId: string, taskId: string,
    sinceMillis: number, limit?: number,
  ): Promise<TaskProgressResponse> {
    const q = new URLSearchParams({ sinceMillis: String(sinceMillis) });
    if (limit) q.set('limit', String(limit));
    return fetchJSON<TaskProgressResponse>(
      `${projectPrefix(projectId)}/tasks/${taskId}/progress/agent?${q.toString()}`,
    );
  },

  async getTaskBuildProgress(
    projectId: string, taskId: string,
    sinceMillis: number,
  ): Promise<TaskProgressResponse> {
    const q = new URLSearchParams({ sinceMillis: String(sinceMillis) });
    return fetchJSON<TaskProgressResponse>(
      `${projectPrefix(projectId)}/tasks/${taskId}/progress/build?${q.toString()}`,
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

};
