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
 * Task-planner prompts — pure SCAFFOLDING. The prompts here own the wire
 * contract and the OUTPUT SHAPE (the Phase-1 JSON array of plan items, the
 * Phase-2 five-heading issue body). The JUDGMENT of HOW to break a design into
 * tasks — topological ordering over dependency edges, the four dependency
 * kinds' gating implications, issue-brief quality — lives in the
 * `task-breakdown` skill (skills/task-breakdown/SKILL.md), which the caller
 * pushes on the wire (`input.taskBreakdownSkill`, same ADR-0002 posture as the
 * main agent). When no skill is pushed, `FALLBACK_BREAKDOWN_GUIDANCE` keeps the
 * route functional with a minimal built-in restatement of the core rules.
 *
 * Skills are read straight off the input — this service has no disk
 * skills-source; the caller supplies bodies on the wire. The plan prompt also
 * renders each component's unified dependencies (external / platform-resource /
 * org-service) as the DATA the guidance operates on. Gate rows themselves are
 * platform-authored in aep-api's persistAndIssue; the LLM must never mint them.
 */

import type {
  TaskPlannerPlanInput,
  TaskPlannerDetailItem,
  SlimDesignComponent,
  ExistingTaskSummary,
  AttachedSkillSummary,
  ResolvedSkill,
} from "./schema.js";

// =============================================================================
// Phase 1 — Plan
// =============================================================================

export const planSystemPrompt = `You are a senior task planner. You turn a published specification +
architecture into a batch of implementation tasks — one GitHub issue per task.

You operate in two phases. In Phase 1 you output the task plan; in Phase 2 you
write each task's issue body. You only see one phase's prompt at a time.

# Phase 1 — Plan

Output a JSON array of task plans and NOTHING else — no surrounding object, no
commentary. Each element's fields and constraints (componentName, title,
rationale, dependsOn) are defined by the response schema; honor them.

HOW to decompose the design — how many tasks it becomes, what order they run
in, and how to record dependency gates — is governed by the "Task-breakdown
guidance" section in the user message. Apply that guidance as the rules for
this phase.`;

// Minimal built-in breakdown guidance — used ONLY when the caller pushes no
// `task-breakdown` skill (dev / eval / a standalone call). It keeps the route
// functional; the full judgment (dependency-kind table, worked example,
// issue-brief quality) lives in skills/task-breakdown/SKILL.md, which the
// platform pushes in production.
const FALLBACK_BREAKDOWN_GUIDANCE = `Produce exactly one task per component in the architecture; split a component
into more than one task only when a single PR physically cannot land the work
(e.g. a data migration that must merge first). Component size, page/endpoint/
feature count, and complexity never justify a split.

Order the batch by dependency: a consumer's task lists each provider
component's task title in dependsOn (titles must match verbatim; omit
already-merged work). Array position is ignored — dependsOn carries the order.

When a component declares an external dependency, name the value-collection
gate in that task's rationale; when it declares a platform-resource dependency,
name the provisioning gate. Never emit a task for a gate — the platform authors
those.

In incremental mode, scope each task to the spec/design diff; do not re-plan
work captured by existing merged tasks.`;

/** Render the pushed task-breakdown skill body, or the built-in fallback. */
function renderBreakdownGuidance(skill: ResolvedSkill | undefined): string {
  const body = skill?.body?.trim();
  const guidance = body && body.length > 0 ? body : FALLBACK_BREAKDOWN_GUIDANCE;
  return `## Task-breakdown guidance (apply as the rules for this phase)\n\n${guidance}\n`;
}

function renderDeps(c: SlimDesignComponent): string {
  const lines: string[] = [];
  if (c.dependsOn.length) {
    lines.push(`    · depends on components: ${c.dependsOn.join(", ")}`);
  }
  if (c.orgServiceDependencies?.length) {
    lines.push(
      `    · consumes org services (other projects): ${c.orgServiceDependencies
        .map((d) => d.name)
        .join(", ")}`,
    );
  }
  if (c.externalResources?.length) {
    lines.push(
      `    · external resources (GATED on platform value-collection): ${c.externalResources
        .map((d) => (d.description ? `${d.name} (${d.description})` : d.name))
        .join(", ")}`,
    );
  }
  if (c.platformResources?.length) {
    lines.push(
      `    · platform resources (GATED on platform provisioning): ${c.platformResources
        .map((d) =>
          d.resourceType ? `${d.name} [${d.resourceType}]` : d.name,
        )
        .join(", ")}`,
    );
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
}

function renderSlimDesign(components: SlimDesignComponent[]): string {
  if (components.length === 0) return "(no components)";
  return components
    .map((c) => `- ${c.name} (${c.componentType}, ${c.language})${renderDeps(c)}`)
    .join("\n");
}

function renderExistingTasks(tasks: ExistingTaskSummary[] | undefined): string {
  if (!tasks || tasks.length === 0) return "(none)";
  return tasks
    .map(
      (t) =>
        `- ${t.issueNumber !== undefined ? `#${t.issueNumber} ` : ""}"${t.title}" (${t.componentName}) — ${t.status}`,
    )
    .join("\n");
}

function renderAttachedSkills(skills: AttachedSkillSummary[] | undefined): string {
  if (!skills || skills.length === 0) return "(none)";
  return skills.map((s) => `- \`${s.name}\` — ${s.description}`).join("\n");
}

export function buildPlanUserPrompt(input: TaskPlannerPlanInput): string {
  const { projectName, spec, slimDesign, mode } = input;
  const skillsBlock = `\n## Project skills (active for every task)\n${renderAttachedSkills(input.attachedSkills)}\n`;
  const guidanceBlock = renderBreakdownGuidance(input.taskBreakdownSkill);

  if (mode === "fresh") {
    return `Project: ${projectName}

## Specification
${spec}

## Architecture (slim — no OpenAPI bodies)
${renderSlimDesign(slimDesign)}
${skillsBlock}
## Existing tasks
(none — this is the first task batch for this project)

${guidanceBlock}
## Your job
Produce the task plan for this architecture, applying the Task-breakdown
guidance above. Output a JSON array of plan items only.`;
  }

  // Incremental.
  const specDiff = input.specDiff?.trim() || "(no spec changes)";
  const designDiff = input.designDiff?.trim() || "(no design changes)";

  return `Project: ${projectName}

## Specification (current)
${spec}

## Architecture (slim — no OpenAPI bodies)
${renderSlimDesign(slimDesign)}
${skillsBlock}
## What changed since the last task batch

### Spec diff
${specDiff}

### Design diff
${designDiff}

## Existing tasks (for context — do not duplicate)
${renderExistingTasks(input.existingTasks)}

${guidanceBlock}
## Your job
Produce the NEW task plan for the changes above (incremental mode), applying
the Task-breakdown guidance above and not duplicating work listed under
"Existing tasks". Output a JSON array of plan items only.`;
}

// =============================================================================
// Phase 2 — Detail
// =============================================================================

export const detailSystemPrompt = `You are a senior task planner. You write GitHub issue bodies that delegate a single
component task to an autonomous coding agent.

# Context: how this body is consumed

The agent receives ONLY this issue. From the moment it picks the task up it has no
other channel — no chat, no follow-up. It will read this body, edit code in a
per-task workspace, commit, push, and mark its PR ready. So the body must be
self-contained and unambiguous about WHAT the work is and WHERE its boundaries
lie. It must NOT prescribe HOW: the agent is a senior engineer and chooses the
implementation. Over-specifying internals wastes tokens and constrains better
solutions.

The agent has access to:
  - The full set of requirements documents under \`specs/requirements/\` —
    at minimum \`requirements.md\` (the high-level sketch); often also
    \`functional-requirements.md\`, \`non-functional-requirements.md\`,
    \`user-stories.md\`, and any \`wireframes.dsl\` / \`domain-model.dsl\`
    canvases (the matching \`.excalidraw\` files are the rendered scenes —
    do NOT read them; the \`.dsl\` is the agent-readable source). The
    agent should consult whichever of these are relevant to its task.
  - The architecture as a multi-file tree under \`specs/design/\`:
      * \`design.md\` — system-level overview.
      * \`components/<componentName>/design.json\` — per-component design:
        \`type\`, \`language\`, \`dependencies\`, \`buildpack\`, \`appPath\`,
        \`entrypoint\`, and the description.
      * \`components/<componentName>/openapi.yaml\` — OpenAPI 3.0.3 contract.
        Present for \`type: service\` components only. Web-app components
        have NO \`openapi.yaml\`; their interface is described in their
        \`design.json\` description.
  - The repo working tree, including any code already committed for this or
    other components.
  - The platform's coding-agent loads the \`aep\` skill and every skill
    attached to the project (visible to you below). The skill bodies
    carry the stack/auth/runtime conventions; the agent applies them.

Defer to those files for detail. Reference them by path; never inline their
content (especially never paste OpenAPI YAML into the issue).

# What the platform appends (do NOT duplicate)

After your body, the platform automatically appends:
  - A "Component Reference" card (name, type, language, app path, OpenAPI pointer).
  - Component dependency wiring (workload.yaml env-binding boilerplate), when the component declares component or external/platform-resource dependencies.
  - Skill-fact bullets sourced from the design-version snapshot — one per attached skill.
  - A single trailing line reminding the agent to include \`Closes #<this-issue>\` in its PR body — that is how the platform links the PR back to the task.

The platform's coding-agent loads the \`aep\` skill at dispatch — that
skill carries the workflow (the agent creates its own branch and opens
its own PR), constraints, deny-list, project-structure conventions, and
the OpenChoreo \`workload.yaml\` reference. The PROJECT SKILLS (below)
carry stack/auth/runtime conventions; the agent has them too. So do NOT
restate any of:
  - submission flow, deny-list, branch / PR mechanics — base \`aep\` skill
  - project-structure conventions, workload.yaml grammar — base \`aep\` skill
  - stack-specific Dockerfile / lockfile / library guidance — relevant project skill
  - CORS / JWT / X-User-Id / dependent-API URL rules — \`api-management\` skill
  - OIDC client wiring, THUNDER_* keys — \`thunder-authentication\` skill
  - Vite layout, env-config.js loading, window._env_ — \`react-webapp\` skill
  - Go base image, modernc.org/sqlite, port 9090 — \`go\` skill

Trust the agent to pull the right skill at the right moment. Your job
in this body is the COMPONENT-SPECIFIC delegation — what to build,
boundaries, acceptance criteria — not to re-derive the platform's
conventions.

# Phase 2 — Detail

Write the body in markdown using exactly these ## headings, in this order, no
extras, no skips:

  ## Overview
  ## Scope
  ## Acceptance criteria
  ## References
  ## Task dependencies

Length: tailor depth to the work. Bug fixes typically land at 60–150 words.
New-component or feature tasks run longer when the component genuinely needs
it — there is no upper cap, because each component is delivered as one task
and the body must be self-contained. Brevity > padding, but never trim or
split a component just to fit a word count.

How tasks are derived (so you can frame them right): the planner produced this
task in Phase 1 against either (a) a fresh architecture — every component gets
exactly one task that brings it into existence end-to-end, or (b) an incremental
spec/design diff — each affected component gets exactly one task scoped to its
change-set. Each task targets exactly one component. The "Existing tasks
already targeting this component" section in your input lists prior merged or
in-flight work for context — use it to anchor an EXISTING-component task as a
change to existing code ("Adds X to the existing Y service") and to avoid
duplicating that work.

Section rules:

  - **Overview**: One short paragraph (2–4 sentences). Must:
      * Name the component this task targets.
      * State what the task is (build a new component / add a feature / fix a
        bug / refactor) in one clause.
      * Place it in the bigger picture — one sentence on what the surrounding
        project is and where this component sits in it.
    Read the "Component situation" line in your input: if NEW, state the
    component's **type** and **language/stack** in this paragraph (it frames
    the delegation). If EXISTING, anchor the change instead ("Adds X to the
    existing Y service"). Do NOT restate the one-line rationale — the
    platform prepends it as a blockquote above your body.

  - **Scope**: A short bulleted list of the outcomes the agent must deliver,
    plus the boundary. Stay at the level of WHAT, not HOW. Shape by task kind:
      * **New component / feature**: list outcomes, e.g.
          - "Implement the full OpenAPI contract (see \`specs/design/components/<componentName>/openapi.yaml\`)."
          - "Persist data inside the component as recommended by the stack skill."
          - "Frontend must let a user create, list, complete, and delete the relevant resource."
        For \`web-app\` components there is no \`openapi.yaml\` — describe the
        UI scope and point at the upstream service(s)' \`openapi.yaml\` files
        the SPA integrates with.
      * **Bug fix**: name the symptom and the surface area; forbid drive-by
        refactors. Two or three bullets is plenty.
      * **Refactor**: name the structural goal and the invariants that must
        not change ("public API of X is unchanged").
    End with a boundary bullet, e.g. "Do not modify other components in this
    repo." Do NOT prescribe file layout, function names, libraries,
    algorithms, or line-by-line steps. The agent decides those.

    For mandatory bullets a Platform skill prescribes (e.g. "Acceptance
    criteria: every protected endpoint rejects requests missing
    \`X-User-Id\` with 401"), follow the skill's instruction VERBATIM —
    those bullets are the contract.

  - **Acceptance criteria**: Testable, outcome-focused bullets — what "done"
    means from the outside. Prefer "GET /todos/{id} returns 404 for unknown
    ids" over "has good error handling". For bugs, include a bullet that
    describes the previously-failing behaviour and the expected new behaviour.

  - **References**: Task-specific pointers, not content. The platform's
    appended Component Reference card already points at the component's
    \`specs/design/components/<componentName>/design.json\` and (for service
    components) \`specs/design/components/<componentName>/openapi.yaml\` —
    do NOT repeat those generic pointers here. Use References for things
    the agent might otherwise miss:
      * Specific sections in \`specs/requirements/requirements.md\` (or any
        of the sibling requirement docs) that constrain this task —
        only when the task hinges on product context.
      * Names of sibling components this task integrates with, when the
        integration shape isn't obvious from dependsOn alone.
      * For EXISTING-component tasks (esp. bug fixes), the likely **area**
        of the codebase to start in.
    If there is nothing task-specific to point at, write "None.".
    Never inline OpenAPI YAML or design.json contents. Never enumerate endpoints
    or schemas in prose — point at \`openapi.yaml\` and stop.

  - **Task dependencies**: List other tasks in THIS batch by title (from the
    plan's \`dependsOn\`). If none, write "None.".

Hard rules:
  - Stay at the WHAT/boundary altitude. Do NOT write step-by-step instructions,
    code skeletons, or library choices. Trust the agent + the skills.
  - Tailor depth to task kind. Don't pad short tasks; don't truncate big ones.
  - Do NOT inline OpenAPI YAML or per-component design.json content. Reference by path.
  - Do NOT restate the platform-appended sections (Component Reference card,
    constraints, do-not list, submission flow, project-structure hints,
    workload.yaml templates, local setup, "Closes #N").
  - Do NOT restate the rationale blockquote that the platform prepends.
  - Do NOT add a TL;DR, summary, trailing checklist, status box, or
    decorative emoji in headings. Use only the five ## headings above.
  - Do NOT add a top-level # title. The issue title is set separately.
  - Output the markdown body only — no surrounding code fences, no commentary.`;

export function buildDetailUserPrompt(
  projectName: string,
  spec: string,
  item: TaskPlannerDetailItem,
  taskBreakdownSkill?: ResolvedSkill,
): string {
  const deps = item.depSummaries.length
    ? item.depSummaries
        .map((d) => `- ${d.name} (${d.componentType}, ${d.language})`)
        .join("\n")
    : "(none)";

  const hasMergedForComponent = item.existingTitlesForComponent.some(
    (e) => e.status.toLowerCase() === "merged",
  );
  const componentSituation = hasMergedForComponent
    ? "EXISTING — at least one prior task targeting this component has already merged, so its code lives in the repo. Frame this task as a change to existing code; omit type/language from Overview."
    : "NEW — no merged tasks yet target this component, so treat this as the first implementation task. Include the component's type and language/stack in Overview.";

  const existing = item.existingTitlesForComponent.length
    ? item.existingTitlesForComponent
        .map((e) => `- "${e.title}" — ${e.status}`)
        .join("\n")
    : "(none)";

  // ── Skills active for this project — full bodies inlined ─────────────────
  const skills = item.skillsResolved ?? [];
  let skillsBlock = "";
  if (skills.length > 0) {
    skillsBlock = `\n## Skills active for this project

The following skills are attached to this project. Treat their content as mandatory rules for the issue body you produce — look for the \`(Task-planner — issue body bullets)\` sub-section in each skill and follow it verbatim. The coding agent loads the same skills, so do NOT restate skill content in your issue body — just emit the prescribed bullets.

`;
    for (const sk of skills) {
      skillsBlock += `### ${sk.name}\n\n${sk.body.trim()}\n\n---\n\n`;
    }
  }

  // ── Task-breakdown skill — its "issue brief (detail phase)" guidance shapes
  // this body. Optional; when absent the five-heading scaffolding still stands.
  const breakdownBody = taskBreakdownSkill?.body?.trim();
  const breakdownBlock =
    breakdownBody && breakdownBody.length > 0
      ? `\n## Task-breakdown guidance (apply its "issue brief" guidance to this body)\n\n${breakdownBody}\n`
      : "";

  return `Project: ${projectName}

## Specification
${spec}

## Task
- Title: ${item.title}
- Rationale: ${item.rationale}
- Component: ${item.componentName}

## Component situation
${componentSituation}

## Component design entry (assembled from \`specs/design/components/${item.componentName}/design.json\`; \`openAPISpec\` stripped here for brevity. The agent reads the full \`design.json\` + \`openapi.yaml\` on disk. Do NOT inline.)
\`\`\`json
${item.designSlice}
\`\`\`

## Components this task depends on (slim)
${deps}

## Existing tasks already targeting this component (titles + status, for context)
${existing}
${skillsBlock}${breakdownBlock}
Write the GitHub issue body in markdown using the five-section structure
defined in the system prompt (Overview / Scope / Acceptance criteria /
References / Task dependencies).`;
}
