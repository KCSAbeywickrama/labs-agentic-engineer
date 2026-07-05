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

// ---------------------------------------------------------------------------
// Domain types for the AEP platform
// ---------------------------------------------------------------------------

export type ProjectPhase =
  | "spec"
  | "design"
  | "components"
  | "implementing"
  | "done";
export type SpecStatus = "draft" | "approved";
export type DesignStatus = "none" | "generating" | "draft" | "approved";
export type ComponentStatus = "created" | "implementing" | "done";

export interface ArtifactVersion {
  version: number;
  tagName: string;
  commitHash: string;
  sourceSpec?: string;
  sourceDesign?: string;
}

export interface Project {
  id: string;
  name: string;
  prompt?: string;
  phase: ProjectPhase;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementsBundle {
  projectId: string;
  files: Record<string, string>;
  status: SpecStatus;
  version?: number;
  versions?: ArtifactVersion[];
  hasUnsavedChanges?: boolean;
}

export interface CollabSession {
  roomId: string;
  wsUrl: string;
  userName?: string;
  email?: string;
}

// -- AI-generated design (structured output from Agent SDK) ------------------

export interface DesignComponent {
  name: string;
  componentType: "service" | "web-app";
  language: string;
  // Unified dependency model — everything this component needs from outside
  // itself, kind-discriminated. Assembled read-time from
  // components/<name>/design.json (status/reason are computed, never
  // persisted).
  dependencies: Dependency[];
  entrypoint: "deployment/service";
  buildpack: "docker";
  appPath: string;
  // Optional: during streaming, the component card appears (with shape
  // metadata) before its OpenAPI YAML is set. Final design.json from the
  // BFF always has a non-empty string here.
  openAPISpec?: string;
  componentAgentInstructions: string;
  // Optional API security policy. Absent ⇒ public (skips the AP gateway).
  // `security: 'required'` ⇒ AP enforces JWT validation against the org's
  // IDP. See docs/design/api-platform-integration.md section 5.1.
  api?: APISecurity;
}

export type DependencyKind =
  | "component"
  | "org-service"
  | "external"
  | "platform-resource";

// One env-var key a component reads at runtime. For an external resource
// these keys form the resource's schema; secret keys route through SM-API.
export interface ConfigKey {
  key: string;
  secret: boolean;
  credentialClass?: "publishable" | "secret";
}

export interface DependencyCandidate {
  label: string;
  description?: string;
  url?: string;
}

// Unified, kind-discriminated dependency. A single shape carries all kinds;
// `kind` selects which optional fields are meaningful (config for external;
// resourceType/parameters for platform-resource).
export interface Dependency {
  kind: DependencyKind;
  name: string;
  description?: string;
  // Read-time computed 4-state resolution (never authored, never persisted).
  status?: "resolved" | "ambiguous" | "unresolved" | "blocked";
  // Why a dep is not yet resolved. `needs-spec` = external dep has no spec
  // yet; `needs-input` = value entry required; `not-found` = no match found;
  // `access-required` = org-service exists but is not accessible (requestable
  // via access requests); `access-pending` = access request in flight;
  // `unpublished` = org-service is project-only. `""` for resolved deps.
  reason?:
    | ""
    | "needs-spec"
    | "needs-input"
    | "not-found"
    | "access-required"
    | "access-pending"
    | "unpublished";
  // external: whether the architect requires a spec file for this dep.
  needsSpec?: boolean;
  // external: path (relative to the component dir) where the spec lives.
  specPath?: string;
  // external: transient published-OpenAPI hint auto-fetched at design save,
  // then cleared once specPath is set.
  specUrl?: string;
  // external: the config key schema the consuming component codes against.
  config?: ConfigKey[];
  // platform-resource: the registered (Cluster)ResourceType + provisioning params.
  resourceType?: string;
  parameters?: Record<string, string>;
  // resolution UI: candidates attached when status === "ambiguous".
  candidates?: DependencyCandidate[];
}

export interface APISecurity {
  security: "required" | "none";
}

export interface Design {
  projectId: string;
  overview: string;
  components: DesignComponent[];
  status: DesignStatus;
  version: number;
  versions?: ArtifactVersion[];
  hasUnsavedChanges?: boolean;
  sourceSpec?: string;
}

// -- ComponentOpenAPI (drives the Test tab) ---------------------------------

export interface ComponentOpenAPI {
  componentName: string;
  componentType: "service" | "web-app";
  // Raw OpenAPI 3.0 YAML, canonicalised by the BFF. Always present on a 200
  // response. On a 409 (non-service component) the BFF returns the same
  // envelope without a spec — the UI can render a typed empty state.
  spec: string;
}

/**
 * DesignBundle pairs the working-tree file map (used by the Explorer
 * architecture page) with the assembled flat Design (used by the cell
 * diagram + downstream code). Returned by `GET /design/bundle` and the
 * per-file mutation endpoints.
 *
 * Files keys are paths relative to `specs/design/` with forward slashes
 * (e.g. `design.md`, `components/user-api/design.md`,
 * `components/user-api/openapi.yaml`).
 */
export interface DesignBundle {
  files: Record<string, string>;
  design: Design | null;
}

// -- Legacy ComponentDefinition (from OC, used in component list/detail) -----

export interface ComponentDefinition {
  id: string;
  projectId: string;
  name: string;
  techStack: string;
  responsibilities: string;
  apiBoundaries: string;
  interactions: string;
  status: ComponentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  prompt?: string;
}

// -- Organizations -----------------------------------------------------------

export interface Organization {
  uuid: string;
  name: string;
  displayName?: string;
  description?: string;
  status?: string;
  createdAt: string;
}

// -- Build (WorkflowRun) ----------------------------------------------------

export type BuildStatus =
  | "Pending"
  | "Running"
  | "Succeeded"
  | "Failed"
  | "Completed"
  | "WorkflowPending"
  | "WorkflowSucceeded"
  | "WorkflowFailed";

export interface Build {
  name: string;
  status: BuildStatus;
  startedAt: string;
  componentName: string;
  projectName: string;
  image: string;
  commit: string;
}

// -- Build Logs ---------------------------------------------------------------

export interface BuildLogEntry {
  timestamp: string;
  log: string;
  level: string;
}

export interface BuildLogs {
  logs: BuildLogEntry[];
  totalCount: number;
}

// -- Implementation Tasks (dispatched to agents) ------------------------------

// Phase 0 single-status lifecycle. Webhooks (and the build watcher polling
// OC) drive transitions; see aep-service/services/task_state.go for the
// transition table.
export type TaskStatus =
  | "pending"
  | "on_hold"
  | "in_progress"
  | "ready_for_review"
  | "merged"
  | "building"
  | "deployed"
  | "rejected"
  | "failed"
  | "abandoned";

export interface ComponentTask {
  id: string;
  projectId: string;
  componentName: string;
  order: number;
  status: TaskStatus;
  workspacePath: string;

  // Tech-lead agent revamp — task-level data lives on the row; component
  // shape (OpenAPI, language, appPath, etc.) is read fresh from
  // specs/design.json on every dispatch.
  title?: string;
  rationale?: string;
  body?: string;
  taskDependsOn?: string[];

  // Lineage — set at generation time, immutable thereafter.
  batchId?: string;
  sourceDesignVersion?: string;
  sourceSpecVersion?: string;

  // GitHub artifacts (1:1:1:1 with this task) — set at dispatch.
  issueUrl?: string;
  issueNumber?: number;
  branchName?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;

  // State derived from webhooks.
  mergeCommitSha?: string;
  lastEventAt?: string;
  lastBuildRunName?: string;
  lastBuildSha?: string;
  lastCodingAgentRunName?: string;

  // GitHub issue labels (for Kanban board)
  labels?: string[];

  // Set when a GH issue body edit failed after retries; reconciler will retry.
  bodySyncPending?: boolean;

  // Error tracking
  errorMessage?: string;

  dispatchedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// -- Task progress (live execution feed) -------------------------------------
// Mirrors aep-service/clients/observer/schema.go and
// remote-worker/src/lib/progress/schema.ts. Versioned NDJSON envelope —
// see docs/design/task-execution-progress.md §5.1.

export const TASK_PROGRESS_SCHEMA_VERSION = 1;

export type TaskProgressKind =
  | "phase"
  | "tool_use"
  | "git_commit"
  | "git_push"
  | "gh_action"
  | "log"
  | "result"
  | "build_step";

export interface TaskProgressEvent {
  schemaVersion: number;
  ts: string;
  seq: number;
  kind: TaskProgressKind;
  // Discriminated payload — only the fields relevant to `kind` are set.
  phase?: string;
  tool?: string;
  sha?: string;
  branch?: string;
  files?: number;
  command?: string;
  level?: "info" | "warn" | "error";
  status?: "success" | "failure";
  summary?: string;
  error?: string;
  step?: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface TaskProgressResponse {
  schemaVersion: number;
  lines: TaskProgressEvent[];
  cursorMillis: number;
  phase?: string;
  truncated?: boolean;
  final: boolean;
}

export interface BuildStep {
  name: string;
  phase?: string;
  message?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskStatusResponse {
  task: ComponentTask;
  buildSteps?: BuildStep[];
}

// -- Generated Tasks ----------------------------------------------------------
// Returned by GET /tasks/generated — enriches live GitHub issues with DB state.

export interface Tasks {
  projectId: string;
  tasks: ComponentTask[];
  status: "approved";
}

// -- Project Board (sourced from GitHub Project Board) -----------------------

export interface LabelInfo {
  name: string;
  color: string; // hex without #, e.g. "0075ca"
}

export type TaskLifecycleStatus =
  | "gh_issue_waiting"
  | "gh_issue_syncing"
  | "gh_issue_created"
  | "gh_issue_failed";

export interface Task {
  id: string;
  title: string;
  url: string;
  description?: string;
  assignee?: string;
  componentTaskId?: string;
  labels?: LabelInfo[];
  lifecycleStatus?: TaskLifecycleStatus;
  // Execution status (mirrors ComponentTask.status). Empty/undefined for
  // rows with no backing ComponentTask. Drives the inline status pill +
  // Live progress button on TaskRow.
  status?: TaskStatus;
  // Time the task was dispatched, ISO-8601. Undefined for never-dispatched
  // tasks; used for the "started Xm ago" caption.
  dispatchedAt?: string;
  // Execution model the task expects. "WORKER" (coding-agent) tasks dispatch
  // through the batch path ("Execute all → Remote Agents"). "SYSTEM" tasks
  // (config-collection, resource-provisioning) never get a GitHub issue and
  // resolve in the architecture-page drawer instead.
  execType?: "SYSTEM" | "WORKER";
  // Component name this task targets — used by the Pending Deps column to
  // map this task back to the dep graph.
  componentName?: string;
  // F4 — list of component names this task is waiting to be deployed.
  // The Pending Deps column renders "Waiting for: …" from this. Empty
  // for unblocked tasks.
  dependsOnComponents?: string[];
  // The other gate kinds a component task waits on — platform-resource
  // provisions, cross-project org-services, and external resources. The
  // On Hold row explains the full reason (not just component gates) from these.
  dependsOnExternalResources?: string[];
  dependsOnOrgServices?: string[];
  dependsOnResources?: string[];
  // Task type: "component" (coding-agent), "config-collection", or
  // "resource-provisioning". Routes the row's action — the last two are
  // resolved in the architecture-page drawer, not the (no-op) exec endpoint.
  type?: string;
  // The dependency this SYSTEM task resolves (resource-provisioning →
  // resourceName; config-collection → externalResourceName). Used to
  // deep-link the architecture drawer (?dep=<name>).
  externalResourceName?: string;
  resourceName?: string;
  // Diagnostic surface for `failed` tasks. Shown so the operator can
  // decide whether to retry.
  errorMessage?: string;
}

export interface ProjectBoard {
  url: string;
  todo: Task[];
  inProgress: Task[];
  done: Task[];
  onHold: Task[];
  failed: Task[];
}

// -- External Resources (org-registered external dependency definitions) ----

export interface ExternalResourceConsumer {
  projectId: string;
  componentName: string;
}

/** An org-registered external resource with its consuming components. */
export interface ExternalResource {
  name: string;
  description?: string;
  configKeys: ConfigKey[];
  consumers: ExternalResourceConsumer[];
}

// -- Access Requests (cross-project org-service visibility) -----------------

export type AccessRequestStatus =
  | "requested"
  | "in_progress"
  | "granted"
  | "rejected";

/**
 * A consumer's request for a provider to publish an org-service dependency
 * cross-project. Created via `POST …/dependencies/{dep}/access-request`
 * (dep-addressed — no orgServiceName body field; the org is implicit).
 */
export interface AccessRequest {
  id: string;
  consumerProjectId: string;
  consumerComponentName: string;
  orgServiceName: string;
  providerProjectId: string;
  providerComponentName: string;
  providerTaskId: string;
  providerIssueNumber: number;
  providerIssueUrl: string;
  status: AccessRequestStatus;
  createdAt: string;
  updatedAt: string;
}

// -- Component Config (Environment Variables) ---------------------------------

export interface EnvVar {
  key: string;
  value: string;
}

export interface ComponentConfig {
  id: string;
  projectName: string;
  componentName: string;
  envVars: EnvVar[];
  createdAt: string;
  updatedAt: string;
}

// -- Project Status (computed SDLC phase) -------------------------------------

export type ProjectSdlcPhase =
  | "no-repo"
  | "repo-cloning"
  | "repo-error"
  | "prompt"
  | "spec"
  | "architecture"
  | "tasks"
  | "components";

export interface ProjectStatus {
  phase: ProjectSdlcPhase;
  repoStatus: string;
  repoUrl: string;
  repoErrorMessage?: string;
  hasSpec: boolean;
  hasDesign: boolean;
  hasTasks: boolean;
  specStatus: string;
  designStatus: string;
}

// -- Deployment (ReleaseBinding) ---------------------------------------------

export interface Deployment {
  name: string;
  environment: string;
  releaseName: string;
  componentName: string;
  endpointUrl: string;
  createdAt: string;
  status: string;
}
